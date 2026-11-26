// =============================================================================
// worldObjects/index.js — PREFAB LIBRARY
//
// The vocabulary worldData.js writes against. Importing this file registers the
// palette and every data prefab. worldRuntime then calls registerLegacyBuilders
// once to expose the big extracted builders (buildings, towers, roads, street).
//
// THREE KINDS OF PREFAB
//   fixed shape        -> data prefab. Batched into InstancedMeshes. Free.
//   needs the row      -> data prefab with build(ctx). ctx carries the whole
//                         row plus w/d/rng/xf. Still batched.
//   owns runtime state -> registerBuilder (lampPosts, iceZones, vehicles…).
//
// Nothing here touches THREE directly except the few builders that must emit
// real meshes or lights. Geometry is described; worldKit compiles it.
// =============================================================================
import {
  definePalette, definePrefab, definePrefabs, registerBuilder, getPrefab,
  makeBox, resolveMat, groundMat, signBoxMaterials,
  addSolidBox, reserveFootprint, rngFor, pickFrom, rangeFrom
} from '../worldKit.js';
import {
  AHC, ahRz, ahRzD, fbm, hillsH, hooks, iceZones, riverX, roadC, terrainH
} from '../state.js';
import { towerMetrics, towerFloorY } from './towers.js';
import { registerFoliage } from './foliage.js';
registerFoliage();

// =============================================================================
// 1 — PALETTE  (named materials; the kit caches and owns them)
// =============================================================================
definePalette({
  // --- structure -----------------------------------------------------------
  asphalt:      { hex: 0x313946, texType: 'asphalt', repeatX: 2, repeatY: 24, roughness: 0.86, bumpScale: 0.015 },
  concrete:     { hex: 0xcbd5e1, texType: 'concrete', repeatX: 12, repeatY: 12, roughness: 0.85 },
  concreteDark: { hex: 0x94a3b8, texType: 'concrete', repeatX: 14, repeatY: 14, roughness: 0.82 },
  sidewalk:     { hex: 0xcbd5e1, texType: 'sidewalk', repeatX: 8, repeatY: 8, roughness: 0.85 },
  plaza:        { hex: 0x94a3b8, texType: 'concrete', repeatX: 14, repeatY: 14, roughness: 0.82 },
  cobble:       { hex: 0xa8a29e, texType: 'cobblestone', repeatX: 6, repeatY: 6, roughness: 0.78 },
  marble:       { hex: 0xf8fafc, texType: 'marble', repeatX: 5, repeatY: 5, roughness: 0.18, clearcoat: 0.85, flatShading: false },
  marbleFloor:  { hex: 0xf1f5f9, texType: 'marble', repeatX: 10, repeatY: 10, roughness: 0.16, clearcoat: 0.9, flatShading: false },
  granite:      { hex: 0x1e293b, texType: 'granite', repeatX: 3, repeatY: 1, roughness: 0.25, flatShading: false },

  // --- metals --------------------------------------------------------------
  steel:        { hex: 0xe2e8f0, texType: 'brushedsteel', metalness: 0.92, roughness: 0.18, flatShading: false },
  chrome:       { hex: 0xf8fafc, texType: 'brushedsteel', metalness: 0.94, roughness: 0.15, flatShading: false },
  steelDull:    { hex: 0x94a3b8, texType: 'brushedsteel', metalness: 0.85, roughness: 0.32, flatShading: false },
  diamond:      { hex: 0x94a3b8, texType: 'diamondplate', repeatX: 2, repeatY: 3, metalness: 0.88, roughness: 0.28 },
  gold:         { hex: 0xfbbf24, metalness: 0.94, roughness: 0.15, flatShading: false },
  brass:        { hex: 0xd97706, metalness: 0.85, roughness: 0.30, flatShading: false },

  // --- interiors -----------------------------------------------------------
  deskDark:     { hex: 0x1c1917, texType: 'wood', repeatX: 2, repeatY: 1, roughness: 0.6 },
  deskTop:      { hex: 0xe2e8f0, texType: 'brushedsteel', metalness: 0.8, roughness: 0.25, flatShading: false },
  chairBlue:    { hex: 0x2563eb, texType: 'fabric', roughness: 0.9 },
  chairGrey:    { hex: 0x475569, texType: 'fabric', roughness: 0.92 },
  sofa:         { hex: 0x334155, texType: 'fabric', roughness: 0.92 },
  monitor:      { hex: 0x0f172a, metalness: 0.5, roughness: 0.35 },
  screen:       { hex: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 0.8 },
  partition:    { hex: 0xd8dee6, texType: 'siding', repeatX: 3, repeatY: 2 },
  carpet:       { hex: 0x3f4652, texType: 'fabric', repeatX: 8, repeatY: 8, roughness: 0.96 },
  ceiling:      { hex: 0xe8eef4, roughness: 0.9 },
  stripLight:   { hex: 0xfff7d6, emissive: 0xfff7d6, emissiveIntensity: 0.9 },
  slat:         { hex: 0x52525b, texType: 'corrugated', repeatX: 8, repeatY: 2, metalness: 0.5, roughness: 0.6 },

  // --- shell / misc --------------------------------------------------------
  dark:         { hex: 0x0f172a, roughness: 0.45, metalness: 0.35 },
  carbon:       { hex: 0x1c1917, roughness: 0.6 },
  white:        { hex: 0xf8fafc, roughness: 0.55 },
  red:          { hex: 0xdc2626, roughness: 0.5 },
  amber:        { hex: 0xf59e0b, roughness: 0.5 },
  wood:         { hex: 0x78350f, texType: 'wood', repeatX: 2, repeatY: 2 },
  woodLight:    { hex: 0xb45309, texType: 'wood', repeatX: 2, repeatY: 2 },
  woodDeck:     { hex: 0x926c44, texType: 'wood', repeatX: 20, repeatY: 2, roughness: 0.82 },
  brick:        { hex: 0xb45309, texType: 'brick', repeatX: 4, repeatY: 2, bumpScale: 0.02 },
  siding:       { hex: 0xe2e8f0, texType: 'siding', repeatX: 3, repeatY: 2 },
  glass:        { hex: 0x38bdf8, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.26, flatShading: false },
  glassWarm:    { hex: 0xbfe6ff, metalness: 0.12, roughness: 0.04, transparent: true, opacity: 0.24 },

  // --- nature --------------------------------------------------------------
  bark:         { hex: 0x78350f, texType: 'wood', repeatX: 1, repeatY: 3, roughness: 0.92, flatShading: true },
  barkBirch:    { hex: 0xf1f5f9, roughness: 0.92, flatShading: true },
  foliage:      { hex: 0x16a34a, roughness: 0.88, flatShading: true },
  foliageDark:  { hex: 0x166534, roughness: 0.88, flatShading: true },
  snow:         { hex: 0xf2f6fa, roughness: 0.9 },
  rock:         { hex: 0x5a554d, roughness: 1, flatShading: true },
  snowrock:     { hex: 0x6b6560, roughness: 1, flatShading: true },
  riverrock:    { hex: 0x4b5563, texType: 'cobblestone', repeatX: 2, repeatY: 2, roughness: 0.95 },
  redrock:      { hex: 0x9a3412, texType: 'redrock', repeatX: 3, repeatY: 2, roughness: 0.92 },
  sand:         { hex: 0xe8d3a2, texType: 'sand', repeatX: 6, repeatY: 6, roughness: 0.96 },
  ice:          { hex: 0x9bdcf5, metalness: 0.5, roughness: 0.08, transparent: true, opacity: 0.7 },
  foam:         { hex: 0xe0f2fe, roughness: 0.4 }
});

// =============================================================================
// 2 — INTERIOR KITS  (the multi-floor tower payload)
//     Local space: origin at floor slab level, +Z toward the front facade.
// =============================================================================
const DESK_POD = {
  id: 'office_desk_pod', kind: 'prop', validate: false,
  params: ['at', 'ry', 's'], footprint: [1.8, 2.2],
  doc: 'Desk + chair + monitor + pedestal. Authored once, instanced everywhere.',
  parts: [
    { g: 'box', m: 'deskDark',  p: [0, 0.55, 0],      s: [1.60, 1.10, 0.80], cast: true },
    { g: 'box', m: 'deskTop',   p: [0, 1.14, 0],      s: [1.70, 0.08, 0.90] },
    { g: 'box', m: 'deskDark',  p: [0.62, 0.42, 0.5], s: [0.42, 0.84, 0.50] },
    { g: 'box', m: 'chairGrey', p: [0, 0.44, -0.95],  s: [0.58, 0.10, 0.58], cast: true },
    { g: 'box', m: 'chairGrey', p: [0, 0.76, -1.20],  s: [0.58, 0.62, 0.12] },
    { g: 'cyl', m: 'steelDull', p: [0, 0.22, -0.95],  s: [0.10, 0.44, 0.10] },
    { g: 'box', m: 'monitor',   p: [0, 1.46, 0.22],   s: [0.72, 0.44, 0.06] },
    { g: 'box', m: 'screen',    p: [0, 1.46, 0.19],   s: [0.66, 0.38, 0.02] },
    { g: 'box', m: 'monitor',   p: [0, 1.20, 0.22],   s: [0.16, 0.10, 0.12] }
  ],
  solids: [{ b: [-0.85, 0.85, 0, 1.18, -0.45, 0.45], tag: 'office_desk', climb: true }],
  anchors: { seat: [0, 0.44, -0.95] }
};

const MEETING_POD = {
  id: 'office_meeting_pod', kind: 'prop', validate: false,
  params: ['at', 'ry', 's'], footprint: [3.4, 3.4],
  parts: [
    { g: 'box', m: 'woodLight', p: [0, 0.74, 0],    s: [2.60, 0.10, 1.30], cast: true },
    { g: 'box', m: 'steelDull', p: [-1.0, 0.37, 0], s: [0.14, 0.74, 0.90] },
    { g: 'box', m: 'steelDull', p: [1.0, 0.37, 0],  s: [0.14, 0.74, 0.90] },
    ...[-0.9, 0, 0.9].flatMap((x) => [
      { g: 'box', m: 'chairBlue', p: [x, 0.44, -1.05], s: [0.56, 0.10, 0.56] },
      { g: 'box', m: 'chairBlue', p: [x, 0.76, -1.30], s: [0.56, 0.60, 0.12] },
      { g: 'box', m: 'chairBlue', p: [x, 0.44, 1.05],  s: [0.56, 0.10, 0.56] },
      { g: 'box', m: 'chairBlue', p: [x, 0.76, 1.30],  s: [0.56, 0.60, 0.12] }
    ])
  ],
  solids: [{ b: [-1.3, 1.3, 0, 0.80, -0.65, 0.65], tag: 'meeting_table', climb: true }]
};

const PRINTER_BAY = {
  id: 'office_printer_bay', kind: 'prop', validate: false,
  params: ['at', 'ry', 's'], footprint: [1.6, 1.0],
  parts: [
    { g: 'box', m: 'slat',      p: [0, 0.50, 0],        s: [1.50, 1.00, 0.70], cast: true },
    { g: 'box', m: 'steelDull', p: [0, 1.06, 0],        s: [1.56, 0.10, 0.76] },
    { g: 'box', m: 'white',     p: [-0.35, 1.28, 0],    s: [0.60, 0.34, 0.50] },
    { g: 'box', m: 'screen',    p: [-0.35, 1.44, 0.26], s: [0.30, 0.10, 0.02] },
    { g: 'box', m: 'carbon',    p: [0.45, 1.24, 0],     s: [0.44, 0.26, 0.44] }
  ],
  solids: [{ b: [-0.78, 0.78, 0, 1.12, -0.38, 0.38], tag: 'printer_bay', climb: true }]
};

definePrefabs({
  office_desk_pod: DESK_POD,
  office_meeting_pod: MEETING_POD,
  office_printer_bay: PRINTER_BAY
});

/** Shared core: lift lobby, risers, washroom block. Every floor has one. */
function floorCore(w, d) {
  const cz = -d / 2 + 2.4;
  return {
    parts: [
      { g: 'box', m: 'partition', p: [0, 1.60, cz - 1.2],    s: [7.0, 3.20, 0.24], cast: true },
      { g: 'box', m: 'partition', p: [-3.5, 1.60, cz],       s: [0.24, 3.20, 2.6] },
      { g: 'box', m: 'partition', p: [3.5, 1.60, cz],        s: [0.24, 3.20, 2.6] },
      { g: 'box', m: 'steel',     p: [-1.1, 1.20, cz - 1.0], s: [1.50, 2.40, 0.12] },
      { g: 'box', m: 'steel',     p: [1.1, 1.20, cz - 1.0],  s: [1.50, 2.40, 0.12] },
      { g: 'box', m: 'screen',    p: [0, 2.55, cz - 1.0],    s: [0.60, 0.24, 0.06] },
      { g: 'box', m: 'steelDull', p: [0, 0.06, cz + 1.4],    s: [3.0, 0.12, 1.6] }
    ],
    solids: [
      { b: [-3.6, 3.6, 0, 3.2, cz - 1.35, cz - 1.05], tag: 'floor_core_wall', climb: false },
      { b: [-3.65, -3.35, 0, 3.2, cz - 1.2, cz + 1.2], tag: 'floor_core_wall', climb: false },
      { b: [3.35, 3.65, 0, 3.2, cz - 1.2, cz + 1.2], tag: 'floor_core_wall', climb: false }
    ]
  };
}

/** Slab + ceiling + perimeter glazing shared by every floor program. */
function floorShell(w, d, floorMat = 'carpet') {
  return {
    parts: [
      { g: 'box', m: floorMat,  p: [0, 0.05, 0], s: [w - 0.6, 0.10, d - 0.6], recv: true },
      { g: 'box', m: 'ceiling', p: [0, 3.30, 0], s: [w - 0.6, 0.12, d - 0.6] },
      ...[-1, 1].map((s) => ({
        g: 'box', m: 'stripLight', p: [s * w * 0.26, 3.18, 0], s: [1.0, 0.10, Math.max(1, d - 3.0)]
      })),
      { g: 'box', m: 'glass', p: [0, 1.70, d / 2 - 0.10],  s: [w - 1.2, 2.60, 0.06] },
      { g: 'box', m: 'glass', p: [-w / 2 + 0.10, 1.70, 0], s: [0.06, 2.60, d - 1.2] },
      { g: 'box', m: 'glass', p: [w / 2 - 0.10, 1.70, 0],  s: [0.06, 2.60, d - 1.2] }
    ],
    solids: [{
      b: [-w / 2 + 0.3, w / 2 - 0.3, -0.10, 0.10, -d / 2 + 0.3, d / 2 - 0.3],
      tag: 'floor_slab', climb: true
    }]
  };
}

const FLOOR_OFFICE = {
  id: 'floor_office', kind: 'interior', validate: false,
  params: ['at', 'w', 'd', 'ry'],
  doc: 'Open plan: 8 desk pods, meeting pod, printer bay, core.',
  build(ctx) {
    const w = ctx.w || 16, d = ctx.d || 16;
    const shell = floorShell(w, d), core = floorCore(w, d);
    return {
      parts: [...shell.parts, ...core.parts],
      solids: [...shell.solids, ...core.solids],
      repeat: [
        { ref: 'office_desk_pod', from: [-w / 2 + 2.6, 0.1, -1.0], step: [3.1, 0, 0], count: 4 },
        { ref: 'office_desk_pod', from: [-w / 2 + 2.6, 0.1, 3.4], step: [3.1, 0, 0], count: 4, ry: Math.PI },
        { ref: 'office_meeting_pod', from: [w / 2 - 3.6, 0.1, -d / 2 + 6.0], count: 1 },
        { ref: 'office_printer_bay', from: [-w / 2 + 2.0, 0.1, d / 2 - 2.2], count: 1 }
      ],
      anchors: { lift: [0, 0.1, -d / 2 + 3.8], stair: [3.0, 0.1, -d / 2 + 3.0] }
    };
  }
};

const FLOOR_RESIDENTIAL = {
  id: 'floor_residential', kind: 'interior', validate: false,
  params: ['at', 'w', 'd', 'ry'],
  doc: 'Four apartments off a central corridor.',
  build(ctx) {
    const w = ctx.w || 16, d = ctx.d || 16;
    const shell = floorShell(w, d, 'woodLight'), core = floorCore(w, d);
    const parts = [...shell.parts, ...core.parts];
    const solids = [...shell.solids, ...core.solids];
    parts.push({ g: 'box', m: 'partition', p: [0, 1.60, 1.2], s: [w - 1.4, 3.20, 0.20], cast: true });
    solids.push({ b: [-w / 2 + 0.7, w / 2 - 0.7, 0, 3.2, 1.10, 1.30], tag: 'corridor_wall', climb: false });
    for (const sx of [-1, 1]) {
      const cx = sx * (w / 4 + 0.4);
      parts.push(
        { g: 'box', m: 'sofa',      p: [cx, 0.45, 3.6],            s: [2.20, 0.80, 1.00], cast: true },
        { g: 'box', m: 'woodLight', p: [cx, 0.32, 5.2],            s: [1.30, 0.54, 0.80] },
        { g: 'box', m: 'white',     p: [cx, 0.40, -2.6],           s: [1.90, 0.70, 1.40] },
        { g: 'box', m: 'granite',   p: [cx + sx * 2.2, 0.55, -3.4], s: [1.80, 1.00, 0.70] }
      );
      solids.push({ b: [cx - 1.1, cx + 1.1, 0, 0.85, 3.1, 4.1], tag: 'apt_sofa', climb: true });
    }
    return { parts, solids, anchors: { lift: [0, 0.1, -d / 2 + 3.8] } };
  }
};

const FLOOR_MECH = {
  id: 'floor_mech', kind: 'interior', validate: false,
  params: ['at', 'w', 'd'],
  doc: 'Plant room: HVAC drums, risers, catwalk. Cheap, no glazing.',
  build(ctx) {
    const w = ctx.w || 16, d = ctx.d || 16;
    const parts = [
      { g: 'box', m: 'concreteDark', p: [0, 0.05, 0], s: [w - 0.6, 0.10, d - 0.6], recv: true },
      { g: 'box', m: 'ceiling',      p: [0, 3.30, 0], s: [w - 0.6, 0.12, d - 0.6] },
      { g: 'box', m: 'stripLight',   p: [0, 3.18, 0], s: [1.0, 0.10, Math.max(1, d - 4.0)] }
    ];
    const solids = [{
      b: [-w / 2 + 0.3, w / 2 - 0.3, -0.10, 0.10, -d / 2 + 0.3, d / 2 - 0.3],
      tag: 'floor_slab', climb: true
    }];
    for (let i = 0; i < 3; i++) {
      const px = -w / 2 + 3.0 + i * 3.4;
      parts.push({ g: 'cyl', m: 'steelDull', p: [px, 1.30, -1.0], s: [2.0, 2.60, 2.0], cast: true });
      solids.push({ b: [px - 1.0, px + 1.0, 0, 2.6, -2.0, 0.0], tag: 'hvac_drum', climb: true });
    }
    parts.push({ g: 'box', m: 'diamond', p: [0, 2.10, d / 2 - 2.4], s: [Math.max(2, w - 3.0), 0.16, 1.6], recv: true });
    solids.push({
      b: [-w / 2 + 1.5, w / 2 - 1.5, 2.02, 2.26, d / 2 - 3.2, d / 2 - 1.6],
      tag: 'mech_catwalk', climb: true
    });
    return { parts, solids };
  }
};

const FLOOR_PENTHOUSE = {
  id: 'floor_penthouse', kind: 'interior', validate: false,
  params: ['at', 'w', 'd'],
  doc: 'Top-floor suite: bar, lounge, terrace glazing.',
  build(ctx) {
    const w = ctx.w || 16, d = ctx.d || 16;
    const shell = floorShell(w, d, 'marbleFloor'), core = floorCore(w, d);
    return {
      parts: [...shell.parts, ...core.parts,
        { g: 'box', m: 'wood',    p: [-w / 2 + 3.0, 0.60, 2.0], s: [3.20, 1.20, 1.10], cast: true },
        { g: 'box', m: 'granite', p: [-w / 2 + 3.0, 1.24, 2.0], s: [3.40, 0.12, 1.25] },
        { g: 'box', m: 'gold',    p: [-w / 2 + 3.0, 1.40, 2.4], s: [2.60, 0.20, 0.20] },
        { g: 'box', m: 'sofa',    p: [w / 2 - 3.4, 0.45, 3.0],  s: [3.40, 0.85, 1.20], cast: true },
        { g: 'box', m: 'sofa',    p: [w / 2 - 3.4, 0.45, 0.4],  s: [1.20, 0.85, 3.40] },
        { g: 'box', m: 'glass',   p: [w / 2 - 3.4, 0.36, 1.7],  s: [1.60, 0.10, 1.60] }
      ],
      solids: [...shell.solids, ...core.solids,
        { b: [-w / 2 + 1.4, -w / 2 + 4.6, 0, 1.30, 1.4, 2.6], tag: 'penthouse_bar', climb: true }
      ],
      anchors: { lift: [0, 0.1, -d / 2 + 3.8] }
    };
  }
};

const FLOOR_RETAIL = {
  id: 'floor_retail', kind: 'interior', validate: false,
  params: ['at', 'w', 'd'],
  doc: 'Concourse retail: shelf runs + counters.',
  build(ctx) {
    const w = ctx.w || 16, d = ctx.d || 16;
    const shell = floorShell(w, d, 'marbleFloor'), core = floorCore(w, d);
    const parts = [...shell.parts, ...core.parts];
    const solids = [...shell.solids, ...core.solids];
    for (let i = 0; i < 3; i++) {
      const pz = -1.0 + i * 3.2;
      parts.push({ g: 'box', m: 'slat', p: [0, 0.90, pz], s: [Math.max(2, w - 5.0), 1.80, 0.70], cast: true });
      solids.push({
        b: [-w / 2 + 2.5, w / 2 - 2.5, 0, 1.80, pz - 0.35, pz + 0.35],
        tag: 'retail_shelf', climb: true
      });
    }
    return { parts, solids };
  }
};

// Parametric floors are DATA prefabs with build(). worldKit calls build(ctx)
// with the row (or the streamer's {w,d} shim) and compiles the returned spec.
for (const def of [FLOOR_OFFICE, FLOOR_RESIDENTIAL, FLOOR_MECH, FLOOR_PENTHOUSE, FLOOR_RETAIL]) {
  definePrefab(def.id, def);
}

// =============================================================================
// 3 — DETAIL KITS + NATURE + STREET PROPS
// =============================================================================
definePrefabs({
  kit_roof_hvac: {
    kind: 'prop', validate: false, params: ['at', 'ry', 's', 'tier'], footprint: [3.0, 2.4],
    doc: 'Rooftop AC unit + duct + vent stack. Emitted by district detail rules.',
    parts: [
      { g: 'box', m: 'steelDull', p: [0, 0.55, 0],       s: [2.20, 1.10, 1.60], cast: true },
      { g: 'box', m: 'carbon',    p: [0, 1.16, 0],       s: [2.30, 0.12, 1.70] },
      { g: 'cyl', m: 'steelDull', p: [-0.6, 1.42, 0],    s: [0.70, 0.40, 0.70] },
      { g: 'cyl', m: 'steelDull', p: [0.6, 1.42, 0],     s: [0.70, 0.40, 0.70] },
      { g: 'box', m: 'steelDull', p: [1.5, 0.40, 0.4],   s: [1.00, 0.50, 0.50] },
      { g: 'cyl', m: 'carbon',    p: [-1.4, 0.70, -0.5], s: [0.34, 1.40, 0.34] }
    ],
    solids: [{ b: [-1.15, 1.15, 0, 1.22, -0.85, 0.85], tag: 'roof_hvac', climb: true }]
  },

  kit_roof_mast: {
    kind: 'prop', validate: false, params: ['at', 's'], footprint: [0.6, 0.6],
    parts: [
      { g: 'cyl', m: 'steelDull', p: [0, 4.0, 0], s: [0.22, 8.0, 0.22], cast: true },
      { g: 'box', m: 'carbon',    p: [0, 7.4, 0], s: [1.20, 0.30, 0.30] },
      { g: 'sphere', m: 'red',    p: [0, 8.2, 0], s: [0.34, 0.34, 0.34] }
    ],
    solids: [{ b: [-0.2, 0.2, 0, 8.0, -0.2, 0.2], tag: 'roof_mast', climb: false }]
  },

  kit_sidewalk_planter: {
    kind: 'prop', validate: false, params: ['at', 'ry', 's'], footprint: [1.4, 1.4],
    parts: [
      { g: 'box', m: 'concreteDark', p: [0, 0.34, 0], s: [1.30, 0.68, 1.30], cast: true },
      { g: 'box', m: 'wood',         p: [0, 0.70, 0], s: [1.16, 0.08, 1.16] },
      { g: 'ico', m: 'foliageDark',  p: [0, 1.16, 0], s: [1.30, 1.10, 1.30], cast: true }
    ],
    solids: [{ b: [-0.65, 0.65, 0, 0.72, -0.65, 0.65], tag: 'planter', climb: true }]
  },

  kit_street_bench: {
    kind: 'prop', validate: false, params: ['at', 'ry'], footprint: [2.2, 0.8],
    parts: [
      { g: 'box', m: 'woodLight', p: [0, 0.44, 0],     s: [2.20, 0.12, 0.72], cast: true },
      { g: 'box', m: 'woodLight', p: [0, 0.74, -0.32], s: [2.20, 0.50, 0.10] },
      { g: 'box', m: 'steel',     p: [-0.95, 0.23, 0], s: [0.12, 0.46, 0.74] },
      { g: 'box', m: 'steel',     p: [0.95, 0.23, 0],  s: [0.12, 0.46, 0.74] }
    ],
    solids: [{ b: [-1.10, 1.10, 0, 0.70, -0.38, 0.38], tag: 'bench', climb: true }]
  },

  // --- trees ---------------------------------------------------------------
  prop_tree: {
  kind: 'prop', validate: false, params: ['at', 's', 'y', 'variant'], footprint: [0.8, 0.8],
  doc: 'variant: omit = conifer | oak | birch | pine',
  build(ctx) {
    const v = ctx.variant;
    if (v === 'pine') return getPrefab('prop_pine').build({ ...ctx, snow: false, tall: false });
    if (v === 'oak' || v === 'birch') {
      const birch = v === 'birch', k = birch ? 0.72 : 1;
      return {
        parts: [
          { g: 'cyl', m: birch ? 'barkBirch' : 'bark', p: [0, 1.6, 0],
            s: [birch ? 0.38 : 0.68, 3.2, birch ? 0.38 : 0.68], cast: true },
          { g: 'ico', m: 'leaf', p: [0, 3.8, 0],       s: [3.80 * k, 3.80 * k, 3.80 * k], cast: true },
          { g: 'ico', m: 'leaf', p: [0.9, 3.3, 0.4],   s: [2.85 * k, 2.85 * k, 2.85 * k], cast: true },
          { g: 'ico', m: 'leaf', p: [-0.8, 3.4, -0.5], s: [3.04 * k, 3.04 * k, 3.04 * k], cast: true }
        ],
        solids: [{ b: [-0.4, 0.4, 0, 3.0, -0.4, 0.4], tag: 'tree', climb: false }]
      };
    }
    return {
      parts: [
        { g: 'cyl',  m: 'bark', p: [0, 0.90, 0], s: [0.60, 1.80, 0.60], cast: true },
        { g: 'cone', m: 'leaf', p: [0, 2.40, 0], s: [3.20, 2.30, 3.20], cast: true },
        { g: 'cone', m: 'leaf', p: [0, 3.65, 0], s: [2.40, 1.90, 2.40], cast: true },
        { g: 'cone', m: 'leaf', p: [0, 4.70, 0], s: [1.60, 1.50, 1.60], cast: true, tier: 'near' }
      ],
      solids: [{ b: [-0.38, 0.38, 0, 2.20, -0.38, 0.38], tag: 'tree', climb: false }]
    };
  }
},
prop_pine: {
  kind: 'prop', validate: false, params: ['at', 's', 'sy', 'snow', 'tall'], footprint: [1.2, 1.2],
  doc: 'snow: true | false | "random". tall: true = northern-range silhouette.',
  build(ctx) {
    const snow = ctx.snow === true || (ctx.snow === 'random' && ctx.rng() > 0.5);
    const sy = Number.isFinite(ctx.sy) ? ctx.sy : 1;
    const parts = [];
    const solids = [{ b: [-0.6, 0.6, 0, 4.8, -0.6, 0.6], tag: 'pine_tree', climb: false }];
    if (ctx.tall) {
      parts.push({ g: 'cyl', m: 'bark', p: [0, 1.2, 0], s: [0.66, 2.4, 0.66], cast: true });
      if (snow) {
        parts.push({ g: 'cone', m: 'leaf', p: [0, 4.2, 0], s: [3.6, 6.4, 3.6], cast: true });
        parts.push({ g: 'cone', m: 'snow', p: [0, 6.6, 0], s: [2.5, 2.6, 2.5] });
      } else {
        parts.push({ g: 'cone', m: 'leaf', p: [0, 5.0, 0], s: [4.2, 8.0, 4.2], cast: true });
      }
    } else {
      parts.push({ g: 'cyl', m: 'bark', p: [0, 0.8, 0], s: [0.50, 1.60, 0.50], cast: true });
      for (const [y, dia, h] of [[2.2, 3.4, 2.2], [3.4, 2.6, 1.9], [4.5, 1.8, 1.6]]) {
        parts.push({ g: 'cone', m: 'leaf', p: [0, y, 0], s: [dia, h, dia], cast: true });
        if (snow && ctx.rng() > 0.5) {
          parts.push({ g: 'cone', m: 'snow', p: [0, y + 0.22, 0], s: [dia * 0.86, h * 0.86, dia * 0.86] });
        }
      }
      if (snow) parts.push({ g: 'sphere', m: 'snow', p: [0, 5.76, 0], s: [1.0, 0.7, 1.0] });
    }
    return {
      parts: parts.map((p) => ({
        ...p, p: [p.p[0], p.p[1] * sy, p.p[2]], s: [p.s[0], p.s[1] * sy, p.s[2]]
      })),
      solids
    };
  }
},
prop_palm: {
  kind: 'prop', validate: false, params: ['at', 's'], footprint: [0.7, 0.7],
  build(ctx) {
    const lean = (ctx.rng() - 0.5) * 0.4;
    const tx = -Math.sin(lean) * 2.5;
    return {
      parts: [
        { g: 'cyl', m: 'bark', p: [0, 2.5, 0], s: [0.40, 5.0, 0.40], r: [0, 0, lean], cast: true },
        ...[0, 1, 2, 3, 4, 5].map((i) => ({
          g: 'box', m: 'leaf',
          p: [tx + Math.cos(i * 1.047) * 1.3, 5.0, Math.sin(i * 1.047) * 1.3],
          s: [3.0, 0.06, 0.70], r: [0, -i * 1.047, -0.35], cast: true
        }))
      ],
      solids: [{ b: [-0.35, 0.35, 0, 4.0, -0.35, 0.35], tag: 'tree', climb: false }]
    };
  }
},
prop_kapok: {
  kind: 'prop', validate: false, params: ['at', 's', 'baseY'], footprint: [3.0, 3.0],
  parts: [
    { g: 'cyl', m: 'bark', p: [0, 7.0, 0], s: [1.30, 14.0, 1.30], cast: true },
    ...[0, 1, 2, 3].map((i) => ({
      g: 'box', m: 'bark',
      p: [Math.cos(i * 1.571 + 0.4) * 0.8, 1.5, Math.sin(i * 1.571 + 0.4) * 0.8],
      s: [0.40, 3.0, 2.0], r: [0, -(i * 1.571 + 0.4), 0]
    })),
    { g: 'dodeca', m: 'leaf', p: [0, 14.0, 0],      s: [11.0, 4.5, 11.0], cast: true },
    { g: 'dodeca', m: 'leaf', p: [1.8, 15.5, -1.2], s: [8.0, 4.0, 8.0], cast: true },
    { g: 'dodeca', m: 'leaf', p: [-1.5, 14.8, 1.4], s: [7.4, 4.0, 7.4], cast: true },
    ...[0, 1, 2, 3].map((v) => ({
      g: 'cyl', m: 'foliageDark',
      p: [Math.cos(v * 1.8) * 2.8, 12.0 - (v % 2) * 0.8, Math.sin(v * 1.8) * 2.8],
      s: [0.10, 3.2 + (v % 2) * 1.6, 0.10]
    }))
  ],
  solids: [{ b: [-1.5, 1.5, 0, 9.8, -1.5, 1.5], tag: 'jungle_tree', climb: false }]
},

  prop_cactus: {
    kind: 'prop', validate: false, params: ['at', 'h'], footprint: [0.7, 0.7],
    build(ctx) {
      const h = ctx.h ?? 3.2;
      return {
        parts: [
          { g: 'cyl', m: 'foliageDark', p: [0, h / 2, 0],              s: [0.48, h, 0.48], cast: true },
          { g: 'box', m: 'foliageDark', p: [-0.35, h * 0.55, 0],       s: [0.65, 0.22, 0.22] },
          { g: 'box', m: 'foliageDark', p: [-0.56, h * 0.55 + 0.35, 0], s: [0.22, 0.75, 0.22] },
          { g: 'box', m: 'foliageDark', p: [0.35, h * 0.68, 0],        s: [0.65, 0.22, 0.22] },
          { g: 'box', m: 'foliageDark', p: [0.56, h * 0.68 + 0.30, 0], s: [0.22, 0.65, 0.22] }
        ],
        solids: [{ b: [-0.35, 0.35, 0, h, -0.35, 0.35], tag: 'cactus', climb: false }]
      };
    }
  },

  prop_boulder: {
    kind: 'prop', validate: false, footprint: [2.0, 2.0],
    params: ['at', 'r', 'sy', 'mat', 'kind', 'cluster', 'spacing', 'foam', 'foamY', 'scatterAlong'],
    doc: 'kind:"log" = fallen trunk. cluster/spacing = group. scatterAlong = polyline.',
    build(ctx) {
      const parts = [], solids = [];
      const mat = ctx.mat || 'rock';
      const sy = Number.isFinite(ctx.sy) ? ctx.sy : 1;
      const rock = (x, y, z, r) => {
        parts.push({
          g: 'dodeca', m: mat, p: [x, y + r * 0.35 * sy, z],
          s: [r * 2, r * 1.4 * sy, r * 2], cast: true
        });
        solids.push({
          b: [x - r * 0.8, x + r * 0.8, y, y + r * 1.1, z - r * 0.8, z + r * 0.8],
          tag: 'boulder', climb: true
        });
      };

      if (ctx.kind === 'log') {
        const r = ctx.r ?? 0.42;
        parts.push({
          g: 'cyl', m: 'bark', p: [0, 0.32, 0], s: [r * 2, 4, r * 2],
          r: [0, 0, Math.PI / 2], cast: true
        });
        solids.push({ b: [-2, 2, 0, 0.73, -0.6, 0.6], tag: 'log', climb: true });
      } else if (ctx.scatterAlong) {
        const { from, to, count = 6, r: rr = [0.22, 0.37] } = ctx.scatterAlong;
        for (let i = 0; i < count; i++) {
          const t = count > 1 ? i / (count - 1) : 0;
          rock(
            from[0] + (to[0] - from[0]) * t + ctx.rng() * 4, 0.05,
            from[1] + (to[1] - from[1]) * t + ctx.rng() * 2,
            rangeFrom(ctx.rng, rr[0], rr[1])
          );
        }
      } else if (ctx.cluster) {
        const n = ctx.cluster, sp = ctx.spacing ?? 1.6, r = ctx.r ?? 1.1;
        for (let i = 0; i < n; i++) rock((i - (n - 1) / 2) * sp, 0, 0, r);
      } else {
        rock(0, 0, 0, ctx.r ?? 1);
      }

      if (ctx.foam) {
        parts.push({
          g: 'ring', m: 'foam', p: [0, ctx.foamY ?? 0.3, -3.5],
          s: [5.2, 5.2, 1], r: [-Math.PI / 2, 0, 0]
        });
      }
      return { parts, solids };
    }
  },

  prop_fern: {
    kind: 'prop', validate: false, params: ['at', 's'], footprint: [1.4, 1.4],
    parts: [{ g: 'cone', m: 'foliage', p: [0, 0.55, 0], s: [2.80, 1.10, 2.80], recv: true }]
  },

  prop_mushroom: {
    kind: 'prop', validate: false, params: ['at'], footprint: [0.6, 0.6],
    parts: [
      { g: 'ico',    m: 'foliageDark', p: [0, 0.55, 0],     s: [1.40, 1.05, 1.40] },
      { g: 'cyl',    m: 'white',       p: [1.4, 0.30, 0.4], s: [0.14, 0.22, 0.14] },
      { g: 'sphere', m: 'red',         p: [1.4, 0.42, 0.4], s: [0.40, 0.28, 0.40] }
    ]
  },

  prop_bloom: {
    kind: 'prop', validate: false, params: ['at', 'color'], footprint: [0.4, 0.4],
    build(ctx) {
      const hex = ctx.color ?? pickFrom(ctx.rng, [0xf43f5e, 0xf59e0b, 0xa855f7, 0x38bdf8]);
      return {
        parts: [{
          g: 'dodeca', m: { hex, emissive: hex, emissiveIntensity: 0.35 },
          p: [0, 1.20, 0], s: [0.70, 0.70, 0.70]
        }]
      };
    }
  },

  // --- street / beach ------------------------------------------------------
  prop_mailbox: {
    kind: 'prop', validate: false, params: ['at', 'bin'], footprint: [0.6, 0.6],
    build(ctx) {
      const parts = [{ g: 'box', m: 'monitor', p: [0, 0.70, 0], s: [0.52, 1.05, 0.52], cast: true }];
      if (ctx.bin) parts.push({ g: 'cyl', m: 'steelDull', p: [0.9, 0.59, 0], s: [0.46, 0.82, 0.46] });
      return { parts, solids: [{ b: [-0.28, 0.28, 0, 1.25, -0.28, 0.28], tag: 'mailbox', climb: true }] };
    }
  },

  prop_bin: {
    kind: 'prop', validate: false, params: ['at'], footprint: [0.5, 0.5],
    parts: [{ g: 'cyl', m: 'steelDull', p: [0, 0.41, 0], s: [0.46, 0.82, 0.46], cast: true }],
    solids: [{ b: [-0.24, 0.24, 0, 0.82, -0.24, 0.24], tag: 'bin', climb: true }]
  },

  prop_umbrella: {
    kind: 'prop', validate: false, params: ['at', 'color', 'towel'], footprint: [3.0, 3.0],
    build(ctx) {
      const parts = [
        { g: 'cyl',  m: 'white', p: [0, 1.30, 0], s: [0.08, 2.40, 0.08] },
        { g: 'cone', m: ctx.color ?? 0xef4444, p: [0, 2.65, 0], s: [3.20, 0.60, 3.20], cast: true }
      ];
      if (ctx.towel) {
        parts.push({ g: 'box', m: ctx.towel, p: [0.9, 0.19, 0.8], s: [1.10, 0.03, 2.00], recv: true });
      }
      return { parts };
    }
  },

  prop_pallet: {
    kind: 'prop', validate: false, params: ['at', 'crate'], footprint: [1.6, 1.2],
    build(ctx) {
      const parts = [{ g: 'box', m: 'wood', p: [0, 0.08, 0], s: [1.60, 0.16, 1.20], cast: true }];
      const solids = [{ b: [-0.8, 0.8, 0, 0.16, -0.6, 0.6], tag: 'pallet', climb: true }];
      if (ctx.crate) {
        parts.push({ g: 'box', m: 'woodLight', p: [0, 0.66, 0], s: [1.10, 1.00, 1.10], cast: true });
        solids.push({ b: [-0.55, 0.55, 0.16, 1.16, -0.55, 0.55], tag: 'alley_crate', climb: true });
      }
      return { parts, solids };
    }
  },

  prop_fence: {
    kind: 'prop', validate: false, params: ['at', 'w', 'h'], footprint: [8.5, 0.3],
    build(ctx) {
      const w = ctx.w ?? 8.5, h = ctx.h ?? 1.15;
      const posts = [];
      for (let x = -w / 2 + 0.25; x <= w / 2 - 0.2; x += 0.9) {
        if (Math.abs(x) < 1.0) continue;
        posts.push({ g: 'box', m: 'white', p: [x, h * 0.42, 0], s: [0.08, h * 0.83, 0.08] });
      }
      return {
        parts: [
          { g: 'box', m: 'white', p: [0, h * 0.65, 0], s: [w, 0.10, 0.10] },
          { g: 'box', m: 'white', p: [0, h * 0.35, 0], s: [w, 0.10, 0.10] },
          ...posts
        ],
        solids: [{ b: [-w / 2, w / 2, 0, h, -0.15, 0.15], tag: 'yard_fence', climb: true }]
      };
    }
  }
});

// =============================================================================
// 4 — PARAMETRIC BUILDERS  (real meshes, lights, or runtime state)
// =============================================================================
registerBuilder('slab', (row, k) => {
  const w = row.w || 10, d = row.d || 10, h = row.h || 0.12, y = row.y ?? 0.18;
  const rep = row.repeat || [Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(d / 3))];
  const mat = row.surface
    ? groundMat(row.surface, {
        color: row.color ?? 0xffffff, repeatX: rep[0], repeatY: rep[1],
        roughness: row.roughness ?? 0.9
      })
    : k.resolveMat(row.mat || 'concrete');
  const m = k.makeBox(k.parent, w, h, d, row.at[0], y - h / 2, row.at[1], mat,
    { recv: true, name: row.name || row.id });
  const boxes = [];
  if (row.solid) {
    boxes.push(k.addSolidBox(row.at[0] - w / 2, row.at[0] + w / 2, y - h, y,
      row.at[1] - d / 2, row.at[1] + d / 2, row.tag || 'slab', true));
  }
  if (row.reserve !== false && row.tag) {
    reserveFootprint(row.at[0] - w / 2 - 1, row.at[0] + w / 2 + 1,
      row.at[1] - d / 2 - 1, row.at[1] + d / 2 + 1, 'road');
  }
  return { object: m, boxes };
}, { params: ['at', 'w', 'd', 'h', 'y', 'surface', 'mat', 'color', 'repeat', 'solid', 'tag', 'reserve'],
     doc: 'Parametric ground / pad slab.' });

registerBuilder('prop_bench', (row, k) => {
  const w = row.w || 2.2, d = row.d || 0.72, y = row.y ?? 0.62, ry = row.ry || 0;
  const g = new k.THREE.Group();
  g.position.set(row.at[0], 0, row.at[1]);
  g.rotation.y = ry;
  g.userData.studioName = row.name || 'Bench';
  k.parent.add(g);
  k.makeBox(g, w, 0.12, d, 0, y, 0, k.resolveMat('woodLight'), { cast: true });
  for (const s of [-1, 1]) {
    k.makeBox(g, 0.12, Math.max(0.1, y - 0.18), d + 0.02,
      s * (w / 2 - 0.25), (y - 0.18) / 2 + 0.18, 0, k.resolveMat('steel'));
  }
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
  return {
    object: g,
    boxes: [k.addSolidBox(row.at[0] - hw, row.at[0] + hw, y - 0.44, y + 0.06,
      row.at[1] - hd, row.at[1] + hd, 'bench', true)]
  };
}, { params: ['at', 'ry', 'w', 'd', 'y'], footprint: [2.2, 0.8] });

registerBuilder('prop_sign', (row, k) => {
  const m = k.makeBox(k.parent, row.w || 4.4, row.h || 1.1, 0.22,
    row.at[0], row.y ?? 3.0, row.at[1],
    signBoxMaterials(row.text || '', row.bg || '#0f172a', row.fg || '#f8fafc'),
    { name: `Sign: ${row.text}`, ry: row.ry || 0 });
  return { object: m };
}, { params: ['at', 'y', 'text', 'bg', 'fg', 'w', 'h', 'ry'], doc: 'Cached neon sign face.' });

registerBuilder('prop_walllamp', (row, k) => {
  const m = k.makeBox(k.parent, 0.5, 0.22, 0.3, row.at[0], row.y ?? 3.6, row.at[1],
    k.resolveMat('stripLight'), { name: row.name || 'Wall lamp' });
  if (row.light) {
    const L = new k.THREE.PointLight(
      row.light.color ?? 0xffd9a0, row.light.intensity ?? 2, row.light.range ?? 16, 2);
    L.position.set(row.at[0], (row.y ?? 3.6) - 0.2, row.at[1] - 2.1);
    k.parent.add(L);
  }
  return { object: m };
}, { params: ['at', 'y', 'light'] });

registerBuilder('prop_stair', (row, k) => {
  const steps = row.steps || 8, rise = row.rise || 0.4, run = row.run || 1.0, w = row.w || 4.0;
  const axis = row.axis || 'z', dir = row.dir ?? -1;
  const boxes = [];
  for (let i = 0; i < steps; i++) {
    const sy = (row.y ?? 0.2) + i * rise, t = (i + 0.5) * run * dir;
    const px = row.at[0] + (axis === 'x' ? t : 0), pz = row.at[1] + (axis === 'z' ? t : 0);
    const sw = axis === 'x' ? run : w, sd = axis === 'x' ? w : run;
    k.makeBox(k.parent, sw, rise, sd, px, sy + rise / 2, pz, k.resolveMat('concrete'), { recv: true });
    boxes.push(k.addSolidBox(px - sw / 2, px + sw / 2, sy, sy + rise, pz - sd / 2, pz + sd / 2, 'stair', true));
  }
  return { boxes };
}, { params: ['at', 'steps', 'rise', 'run', 'w', 'axis', 'dir', 'y'], doc: 'Real climbable staircase.' });

registerBuilder('prop_ice_lake', (row, k) => {
  const w = row.w || 9, d = row.d || w * 0.6;
  let y = row.y;
  if (!Number.isFinite(y)) {
    y = -Infinity;
    for (const sx of [-0.5, 0, 0.5]) {
      for (const sz of [-0.5, 0, 0.5]) {
        y = Math.max(y, terrainH(row.at[0] + sx * w, row.at[1] + sz * d));
      }
    }
    y += 0.06;
  }
  const m = k.makeBox(k.parent, w, 0.5, d, row.at[0], y - 0.25, row.at[1],
    k.resolveMat('ice'), { recv: true, name: 'Frozen lake' });
  iceZones.push({ x: row.at[0], z: row.at[1], r: w * 0.5 });
  return {
    object: m,
    boxes: [k.addSolidBox(row.at[0] - w / 2, row.at[0] + w / 2, y - 0.5, y,
      row.at[1] - d / 2, row.at[1] + d / 2, 'frozen_lake', true)]
  };
}, { params: ['at', 'w', 'd', 'y'] });

// =============================================================================
// 5 — LEGACY BUILDER SLOTS
//     worldRuntime calls registerLegacyBuilders({...}) once at boot. Every key
//     below is a prefab id worldData.js already uses. Missing keys are simply
//     not registered — worldKit logs and skips those rows, never crashes.
// =============================================================================
export const LEGACY_SLOTS = [
  'terrain_plane', 'terrain_heightfield', 'terrain_bed', 'terrain_skirt', 'ground_patch', 'backstop',
  'water_surface', 'river_system', 'ocean_seabed',
  'road_grid', 'road_run', 'road_ribbon', 'road_loop', 'freeway_i88',
  'bridge_river', 'bridge_deck', 'ramp_driveable', 'pullout',
  'tower', 'house_walkin', 'house_suburban', 'shop_hotdog', 'shop_bank', 'shop_dealer',
  'shop_armory', 'shop_diner', 'apartment_block', 'container_stack', 'hospital',
  'concert_hall', 'arena', 'hangar', 'terminal_lax', 'theme_building', 'atc_tower',
  'temple', 'hideout', 'estate_house', 'estate_wall', 'estate_gate', 'mesa',
  'westside_tower', 'westside_low', 'runway', 'speedway_track', 'speedway_pit',
  'prop_lamppost', 'prop_hydrant', 'prop_shelter', 'prop_cart', 'prop_fountain',
  'prop_pier', 'prop_lifeguard', 'prop_campfire', 'prop_tent', 'prop_buoy',
  'prop_rowboat', 'prop_sailboat', 'prop_ferris_wheel', 'prop_jet', 'prop_service',
  'prop_cliff', 'prop_sign_arch', 'prop_gantry', 'prop_dumpster', 'prop_fire_escape',
  'ice_zones', 'sewer_network', 'vehicle'
];

/** worldTerrain.registerTerrainPrefabs() owns these. Never overwrite them. */
const TERRAIN_OWNED = new Set([
  'terrain_plane', 'terrain_heightfield', 'terrain_bed', 'terrain_skirt', 'ground_patch',
  'backstop', 'water_surface', 'river_system', 'ocean_seabed', 'bridge_river',
  'prop_log', 'prop_buoy', 'prop_rowboat', 'prop_sailboat'
]);

const ADAPTED = new Set([
  'house_walkin', 'house_suburban', 'shop_hotdog', 'shop_bank', 'shop_dealer',
  'shop_armory', 'tower', 'prop_lamppost', 'prop_hydrant', 'prop_shelter',
  'prop_cart', 'prop_fountain', 'vehicle'
]);

export function registerLegacyBuilders(B = {}) {
  const at = (r) => ({ x: r.at[0], z: r.at[1] });
  const reg = (id, fn, meta) => {
    if (fn && !TERRAIN_OWNED.has(id)) registerBuilder(id, fn, meta);
  };

  // --- buildings -----------------------------------------------------------
  reg('house_walkin', (r) => B.house_walkin({
    ...at(r), w: r.w, d: r.d, h: r.h, wallColor: r.wall, roofColor: r.roof,
    label: r.name, baseY: r.baseY, foundation: r.foundation
  }), { footprint: [9.8, 8.6],
        params: ['at', 'w', 'd', 'h', 'wall', 'roof', 'name', 'baseY', 'foundation'] });

  reg('house_suburban', (r) => B.house_suburban({
    ...at(r), w: r.w, d: r.d, h: r.h, wallColor: r.wall, roofColor: r.roof, rotY: r.ry || 0
  }), { footprint: [8.4, 7.4], params: ['at', 'w', 'd', 'h', 'wall', 'roof', 'ry'] });

  reg('shop_hotdog', (r) => B.shop_hotdog(r.at[0], r.at[1]), { footprint: [11.4, 9.6], params: ['at'] });
  reg('shop_bank',   (r) => B.shop_bank(r.at[0], r.at[1]),   { footprint: [16.4, 13.6], params: ['at'] });
  reg('shop_dealer', (r) => B.shop_dealer(r.at[0], r.at[1]), { footprint: [15.6, 12.6], params: ['at'] });
  reg('shop_armory', (r) => B.shop_armory(r), { footprint: [20, 22], params: ['at', 'w', 'd', 'h', 'baseY', 'ammo'] });

  // --- tower: metrics drive height AND per-floor vertical streaming ---------
  reg('tower', (r) => {
    const m = towerMetrics(r);
    const rec = B.tower({
      id: r.id, a: r.style || 'glass', x: r.at[0], z: r.at[1], w: r.w, d: r.d, ...m,
      glassHex: r.glass, frameHex: r.frame, name: r.name,
      crown: r.crown || 'block', heli: r.crown === 'helipad', pad: r.pad, baseY: r.baseY
    });
    if (!rec) return null;
    if (B.registerTowerFloors) B.registerTowerFloors(rec, r, m);
    return {
      object: rec.group, boxes: rec.boxes,
      anchors: { lobby: [rec.x, rec.baseY, rec.z], roof: [rec.x, rec.roofY, rec.z] }
    };
  }, { params: ['at', 'w', 'd', 'floors', 'floorH', 'lobbyH', 'program', 'crown', 'style',
                'glass', 'frame', 'name', 'pad', 'baseY'],
       doc: 'h = lobbyH + (floors-1)·floorH. Program streams furnished floors.' });

  // --- street systems (builders: they own runtime state) -------------------
  reg('prop_lamppost', (r) => B.prop_lamppost(r.at[0], r.at[1]), { footprint: [0.4, 0.4], params: ['at'] });
  reg('prop_hydrant',  (r) => B.prop_hydrant(r.at[0], r.at[1]),  { footprint: [0.4, 0.4], params: ['at'] });
  reg('prop_shelter',  (r) => B.prop_shelter(r.at[0], r.at[1], r.ry || 0), { footprint: [3.8, 1.5], params: ['at', 'ry'] });
  reg('prop_cart',     (r) => B.prop_cart(r.at[0], r.at[1]),     { footprint: [2.2, 1.3], params: ['at'] });
  reg('prop_fountain', (r) => B.prop_fountain(r.at[0], r.at[1]), { footprint: [7.2, 7.2], params: ['at'] });

  // --- vehicles ------------------------------------------------------------
  reg('vehicle', (r) => {
    const cfg = {
      name: r.name, bodyHex: r.body, accentHex: r.accent,
      x: r.at[0], z: r.at[1], y: r.y, yaw: r.ry || 0,
      isCoupe: r.coupe !== false, isSupercar: !!r.super, isBus: !!r.bus
    };
    const v = (r.bus && B.bus) ? B.bus(cfg) : B.vehicle(cfg);
    if (v && r.tank) v.isTank = true;
    return { object: v?.root || null };
  }, { params: ['at', 'y', 'ry', 'name', 'body', 'accent', 'coupe', 'super', 'tank', 'bus'] });

  // --- everything else: pass the row straight through ----------------------
  for (const id of LEGACY_SLOTS) {
    if (ADAPTED.has(id) || TERRAIN_OWNED.has(id)) continue;
    if (B[id]) registerBuilder(id, (r, k) => B[id](r, k), { params: ['at'] });
  }
  return LEGACY_SLOTS.filter((id) => B[id] && !TERRAIN_OWNED.has(id)).length;
}

// =============================================================================
// 6 — KEEP-OUTS
//     Published to worldTerrain through a hook so rivers can add keep-outs
//     without a static import cycle (index -> towers -> shell -> worldTerrain).
// =============================================================================
const keepouts = [];

export function addKeepout(x, z, r, tag = '') {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) return keepouts.length;
  keepouts.push({ x, z, r, tag });
  return keepouts.length;
}
export function addKeepoutPath(pts, r, tag = '', step = 1) {
  const n = Math.max(1, Math.round(step));
  for (let i = 0; i < pts.length; i += n) addKeepout(pts[i].x, pts[i].z, r, tag);
  return keepouts.length;
}
export function clearKeepouts() { keepouts.length = 0; }
export function allKeepouts() { return keepouts; }
export function keepoutClear(x, z, r = 0) {
  for (let i = 0; i < keepouts.length; i++) {
    const k = keepouts[i], dx = x - k.x, dz = z - k.z, rr = k.r + r;
    if (dx * dx + dz * dz < rr * rr) return false;
  }
  return true;
}
hooks.addScatterKeepout = addKeepout;

// =============================================================================
// 7 — SCATTER EXPANSION  (spec -> deterministic placement rows)
//
//   bounds  [x0, z0, x1, z1]
//   avoid   { at:[x,z], r }              disc  (at:'AHC' resolves the plateau)
//           { x:-24, r:8 }               vertical corridor, all z
//           { z:150, r:5 }               horizontal corridor, all x
//           { path:'roadC', r }          centreline (ahRz uses perpendicular)
//           { bounds:[x0,z0,x1,z1], r? } rect, r pads it
//           'keepouts' | 'jungleClear'
// =============================================================================
const PATHS = {
  roadC: (x, z) => roadC(z),
  riverX: (x, z) => riverX(z),
  ahRz: (x, z) => ahRz(x)
};

function avoidClear(x, z, spec, pad = 0) {
  const f = spec.filter || {};

  if (f.avoid === 'keepouts') {
    return keepoutClear(x, z, spec.keepout === 'r' ? 3 : (spec.keepout || 1));
  }
  if (f.avoid === 'jungleClear') {
    if (x < 372 || x > 529 || z < -176 || z > 236) return false;
    if (x > 408 - pad && x < 428 + pad) return false;
    if (Math.abs(z - 40) < 8 + pad && x < 478) return false;
    if (x > 426 - pad && x < 486 + pad && z > -100 - pad && z < -28 + pad) return false;
    if ((x - 454) ** 2 + (z - 96) ** 2 < (9 + pad) ** 2) return false;
    if ((x - 418) ** 2 + (z + 137) ** 2 < (14 + pad) ** 2) return false;
    return true;
  }

  for (const a of f.avoid || []) {
    const r = (a.r || 0) + pad;
    if (a.path && PATHS[a.path]) {
      if (a.maxDist !== undefined && (-196 - x) >= a.maxDist) continue;
      const d = a.path === 'ahRz'
        ? Math.abs(z - ahRz(x)) / Math.hypot(1, ahRzD(x))
        : Math.abs(x - PATHS[a.path](x, z));
      if (d < (r || 8)) return false;
      continue;
    }
    if (a.bounds) {
      const [x0, z0, x1, z1] = a.bounds;
      if (x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r) return false;
      continue;
    }
    if (a.x !== undefined) { if (Math.abs(x - a.x) < r) return false; continue; }
    if (a.z !== undefined) { if (Math.abs(z - a.z) < r) return false; continue; }
    if (a.at) {
      const ax = a.at === 'AHC' ? AHC.px : a.at[0];
      const az = a.at === 'AHC' ? AHC.pz : a.at[1];
      if ((x - ax) ** 2 + (z - az) ** 2 < (r || 6) ** 2) return false;
    }
  }
  for (const [za, zb] of f.avoidZ || []) if (z > za && z < zb) return false;
  return true;
}

export function expandScatters(specs = []) {
  const rows = [];
  for (const spec of specs) {
    const rng = rngFor(spec.id);
    const [x0, z0, x1, z1] = spec.bounds;
    const f = spec.filter || {};
    const [sMin, sMax] = spec.s || [1, 1];
    const [yMin, yMax] = spec.yScale || [1, 1];
    const heightAt = spec.y === 'hillsH' ? hillsH : terrainH;
    const everyKeys = spec.every
      ? Object.keys(spec.every).map(Number).sort((a, b) => a - b)
      : null;
    let placed = 0;

    for (let i = 0; i < (spec.tries || spec.count * 8) && placed < spec.count; i++) {
      const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0);
      const h = heightAt(x, z);
      if (f.hMin !== undefined && h < f.hMin) continue;
      if (f.hMax !== undefined && h > f.hMax) continue;
      const slope = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) / 6;
      if (f.slopeMax !== undefined && slope > f.slopeMax) continue;
      if (f.slopeMin !== undefined && slope < f.slopeMin) continue;
      if (f.groveMin !== undefined &&
          fbm(x * (f.groveFreq || 0.05), z * (f.groveFreq || 0.05), 2) < f.groveMin) continue;
      if (!avoidClear(x, z, spec, spec.pad || 0)) continue;

      const s = sMin + rng() * (sMax - sMin);
      const sy = yMin + rng() * (yMax - yMin);
      const y = (spec.y === 'terrain' || spec.y === 'hillsH' || spec.y === undefined) ? h : spec.y;

      let prefab = spec.prefab;
      if (everyKeys) {
        for (const k of everyKeys) { if (i % k === 0) { prefab = spec.every[k]; break; } }
      }

      const row = {
        id: `${spec.id}/${placed}`, prefab, at: [x, z], y, s, sy,
        ry: rng() * Math.PI * 2, validate: false, selectable: false
      };
      if (spec.snow !== undefined) row.snow = spec.snow === 'random' ? rng() > 0.5 : spec.snow;
      if (spec.variant) row.variant = Array.isArray(spec.variant) ? pickFrom(rng, spec.variant) : spec.variant;
      if (spec.mat) row.mat = spec.mat;
      if (spec.tall) row.tall = true;
      if (spec.baseY !== undefined) row.baseY = spec.baseY;
      if (spec.solid === false) row.solid = false;
      if (spec.aspect) { row.w = s; row.d = s * spec.aspect; row.y = undefined; }
      rows.push(row);

      if (spec.keepout) addKeepout(x, z, spec.keepout === 'r' ? s : spec.keepout, spec.id);
      placed++;
    }
  }
  return rows;
}

// =============================================================================
// 8 — DISTRICT EXPANSION  (blocks, pads, surfaces, detail rules -> rows)
// =============================================================================
function layerValue(v, bw) {
  if (typeof v === 'number') return v;
  if (v === 'bw') return bw;
  const m = /^bw\s*-\s*(\d+(?:\.\d+)?)$/.exec(String(v || ''));
  if (m) return bw - Number(m[1]);
  return 10;
}

export function expandDistricts(districts = []) {
  const rows = [];
  for (const D of districts) {
    // --- explicit surfaces -------------------------------------------------
    for (const s of D.surfaces || []) {
      rows.push({
        id: s.id, prefab: 'slab', at: s.at, w: s.w, d: s.d, y: s.y, h: s.h ?? 0.2,
        surface: s.surface, mat: s.mat, color: s.color, repeat: s.repeat,
        solid: s.solid, tag: s.tag
      });
    }

    // --- pads --------------------------------------------------------------
    for (const p of D.pads?.at || []) {
      rows.push({
        id: `${D.id}/pad_${p[0]}_${p[1]}`, prefab: 'slab', at: p,
        w: D.pads.w, d: D.pads.d, y: D.pads.y, h: 0.12,
        surface: D.pads.surface || 'sidewalk'
      });
      if (D.detail?.lamps === 'pad_corners') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          rows.push({
            id: `${D.id}/padlamp_${p[0]}_${p[1]}_${sx}_${sz}`, prefab: 'prop_lamppost',
            at: [p[0] + sx * (D.pads.w / 2 - 1.4), p[1] + sz * (D.pads.d / 2 - 1.4)],
            validate: false
          });
        }
      }
    }

    // --- grid blocks -------------------------------------------------------
    const B = D.blocks;
    if (B) {
      for (const bx of B.xs) for (const bz of B.zs) {
        const bw = B.widthRule === 'bx===104 ? 28 : 36' ? (bx === 104 ? 28 : 36) : 36;

        B.layers.forEach((L, li) => {
          let surface = L.surface, color = L.color;
          if (L.rule === 'bz<=-72 ? plaza : lawn') {
            if (bz <= -72) { surface = 'concrete'; color = 0x94a3b8; }
            else { surface = 'grass'; color = 0x5ca450; }
          }
          rows.push({
            id: `${D.id}/blk_${bx}_${bz}_${li}`, prefab: 'slab', at: [bx, bz],
            w: layerValue(L.w, bw), d: layerValue(L.d, bw), h: L.h, y: L.y,
            surface, color, repeat: L.repeat
          });
        });

        const lamps = D.detail?.lamps;
        if (lamps && typeof lamps === 'object') {
          const inset = lamps.dx !== undefined ? bw / 2 - lamps.dx : (lamps.inset ?? bw / 2 - 1.2);
          const dz = lamps.dz ?? 16.8;
          rows.push({ id: `${D.id}/lamp_${bx}_${bz}_a`, prefab: 'prop_lamppost',
            at: [bx - inset, bz - dz], validate: false });
          rows.push({ id: `${D.id}/lamp_${bx}_${bz}_b`, prefab: 'prop_lamppost',
            at: [bx + inset, bz + dz], validate: false });
        }

        if (D.detail?.roofKit === 'hvac_scatter') {
          const rng = rngFor(`${D.id}/roof_${bx}_${bz}`);
          for (let i = 0; i < 2; i++) {
            rows.push({
              id: `${D.id}/hvac_${bx}_${bz}_${i}`, prefab: 'kit_roof_hvac',
              at: [bx + (rng() - 0.5) * bw * 0.5, bz + (rng() - 0.5) * 24],
              validate: false, tier: 'mid'
            });
          }
        }

        if (D.detail?.sidewalk === 'planters_benches') {
          rows.push({ id: `${D.id}/pl_${bx}_${bz}`, prefab: 'kit_sidewalk_planter',
            at: [bx - bw / 2 + 1.6, bz + 15.0], validate: false });
          rows.push({ id: `${D.id}/bn_${bx}_${bz}`, prefab: 'kit_street_bench',
            at: [bx + bw / 2 - 1.6, bz - 15.0], ry: Math.PI / 2, validate: false });
        }
      }
    }

    // --- street trees ------------------------------------------------------
    const trees = D.detail?.trees;
    if (trees?.rule === 'along') {
      for (let x = trees.from, i = 0; x <= trees.to; x += trees.step, i++) {
        if (trees.skip && x > trees.skip[0] && x < trees.skip[1]) continue;
        rows.push({
          id: `${D.id}/tree_${i}`, prefab: 'prop_tree',
          at: [x, trees.z], s: trees.s || 1, validate: false
        });
      }
    }
  }
  return rows;
}

// =============================================================================
// 9 — TOWER FLOOR PROGRAM  (run-length -> per-floor stream cell descriptors)
//     Floor 0 is the built lobby. Floor i sits at lobbyH + (i-1)*floorH.
// =============================================================================
const PROGRAM_KIND = {
  lobby: null, office: 'floor_office', mech: 'floor_mech',
  residential: 'floor_residential', penthouse: 'floor_penthouse', retail: 'floor_retail'
};

export function expandTowerFloors(rec, row, meta) {
  const m = meta && meta.floors ? meta : towerMetrics(row);
  const prog = Array.isArray(row.program) ? row.program : [['office', m.floors - 1]];
  const baseY = Number.isFinite(row.baseY) ? row.baseY : 0.18;
  const cells = [];
  let i = 0;
  for (const [kind, count] of prog) {
    for (let n = 0; n < count && i < m.floors; n++, i++) {
      if (i === 0) continue;
      const prefab = PROGRAM_KIND[kind];
      if (!prefab) continue;
      cells.push({
        id: `${row.id}/f${String(i).padStart(2, '0')}`, prefab,
        x: rec.x, z: rec.z, y: towerFloorY(baseY, i, m),
        w: row.w, d: row.d, ry: 0,
        r: Math.max(row.w, row.d) * 1.6 + 14,
        band: m.floorH * 2.1,
        mode: 'stream', tier: 'interior', priority: 1
      });
    }
  }
  return cells;
}

export const CATALOG_NOTE =
  'Regenerate the worldData.js catalog with kit.generateCatalog() after editing this file.';

export default {
  LEGACY_SLOTS, registerLegacyBuilders,
  addKeepout, addKeepoutPath, clearKeepouts, keepoutClear, allKeepouts,
  expandScatters, expandDistricts, expandTowerFloors
};