# Grand Theft Aura + Aura Studio

A 3D browser game and a Roblox-Studio-style world/model/asset editor, built on the **same** Three.js engine,
world builders, meshes, assets and parameters. Pure native ES modules: **no bundler, no build step.**

## Quick start

ES modules cannot run from `file://`, so serve the folder over HTTP. Use the launchers:

| OS      | Double-click            | What it does |
|---------|-------------------------|--------------|
| Windows | `start-windows.bat`     | Starts a local server (Python, or Node as a fallback) and opens the game. |
| macOS   | `start-mac.command`     | Same. First run: right-click -> Open (Gatekeeper), or `chmod +x start-mac.command`. |

Then use:

- **Game:** <http://localhost:8080/index.html>
- **Studio:** <http://localhost:8080/studio.html>  (`start-windows.bat studio` / `./start-mac.command studio` opens it directly)

Manual alternative from this folder: `python3 -m http.server 8080` or `npx http-server -p 8080`.
An internet connection is needed on first load (Three.js, Tailwind and fonts come from a CDN).

## Game controls

| Key | Action |
|-----|--------|
| `W A S D` + `Shift` | Move / sprint |
| `Space` / `C` | Jump and mantle ledges / crouch |
| Hold `G` | Pickpocket (sneak up behind an NPC) |
| `LMB` (hold) | Rapid fire / punch / swing |
| `RMB` | Toggle ballistic aim |
| `Q` or mouse wheel | Weapon wheel |
| `U` | Use left-hand item |
| `E` | Interact / inventory / refill hotdog shooter |
| `F` | Enter / exit car |
| `I` / `K` | Gear up / gear down (6-speed manual) |
| `W` / `S` (in car) | Accelerate / brake and reverse |
| `Space` (in car) | Handbrake |
| `V` | Aerial point of view |
| `M` | Full map |
| `Tab` / `Esc` | Pause / settings |

## Aura Studio

Four panes: **ribbon** (top), **toolbox + asset browser** (left), **multi-tab 3D viewport** (center),
**Explorer + Properties** (right).

**Viewport**
- `World Map` tab (pinned): the full city, I-88 freeway, desert and every `levelData.entities` object.
- Model tabs (closable): `Player Character Rig`, `Apex GT Supercar`, `Sports Coupe`, `Hotdog Shooter`, `Wooden Bat`,
  `Steel Crowbar`, `Tactical Pipe`, `NPC Guard`. Open them from the toolbox, or double-click a model/entity in the Explorer.
  The world is hidden and the model is centred on a pedestal at (0, 0, 0).
- Right-drag: look / orbit. Wheel: zoom. Middle-drag: pan. Hold right mouse + `W A S D` (`Q`/`E` down/up, `Shift` boost) or
  use the arrow keys to fly. `F`: focus the selection.

**Tools:** `Q` Select, `W` Move, `E` Rotate, `R` Scale, grid snap (Off, 0.25, 0.5, 1, 2 m), `Ctrl+Z` / `Ctrl+Y` undo/redo,
`Ctrl+D` duplicate, `Del` delete, **Reset defaults**.

**Workflow buttons**
- **Save & Test in Game** saves your level to this browser (`localStorage`) and opens the game in a new tab.
- **Export levelData.js** downloads a drop-in replacement for `js/levelData.js` containing your changes, so they become permanent.

**Explorer / Inspector**
- *Models*, *Audio Bindings*, *Game Parameters* (Player Stats, Vehicle Gear Speeds, each Weapon) and *Workspace Entities*.
- Entities: name, color, PNG texture + UV repeat, position / rotation / scale, and type-specific options.
- Parameters: HP, cash, move speed, jump, sprint, gear MPH caps, handling multipliers, weapon damage / cooldown / reach.

## Custom assets

**Textures** (`assets/textures/`): Studio -> *Assets* -> `+ Import PNG Texture`, confirm the path
(`assets/textures/<name>.png`), click the thumbnail to apply it to the selected object, set UV repeat in the Inspector.
**Audio** (`assets/audio/`): `+ Import Audio File` (`.mp3`, `.wav`, `.ogg`), preview with *Play*, then bind it in
*Explorer -> Audio Bindings* to `hotdogFire`, `batSwing`, `punch`, `pickup`, `carHorn`, `engineLoop` or `bgMusic`.
Leave an event on *Built-in synth* to keep the original procedural Web Audio sound; a missing/broken file falls back to it automatically.

Studio previews imported files immediately (kept in this browser). **For a permanent setup, copy each file into
`assets/textures/` or `assets/audio/` under exactly the name you chose** (Studio can download a correctly named copy), then
use *Export levelData.js* and replace `js/levelData.js`.

## Project layout and import hierarchy

```
index.html / studio.html        entry pages (shared import map -> three@0.169.0)
styles/hud.css, studio.css
assets/textures, assets/audio
js/
  levelData.js   parameters, asset bindings, prefabs, entities   (imports nothing)
  state.js       gameState, player, registries, terrain/collision math, `hooks`
  engine.js      scene, camera, renderer (initEngine), lights, makeMat, graphics tiers
  assets.js      texture + audio loaders and overrides
  audio.js       procedural Web Audio sfx + custom file playback
  items.js       weapons, items, mesh builders, projectiles, crates, pickups
  vehicles.js    car meshes, 6-speed gearbox, driving physics
  world.js       roads, freeway, desert, biomes, interiors, skyscrapers, entity spawner, buildWorld()
  npcs.js        clans, NPC meshes + AI, pickpocketing, police, rats
  player.js      rigs, movement, parkour, meteor drop, per-frame simulation
  input.js       keyboard / mouse / pointer lock           (initInput)
  ui.js          HUD, minimap, modals, save/load JSON      (initUI)
  main.js        game entry + loop
  editor/studio.js
```

Each file only imports files **above** it in this list (verified: zero circular imports). Where a lower layer must call
a higher one (e.g. a weapon hit that updates the HUD) it goes through the small `hooks` registry in `state.js`;
the higher module registers its implementation at the bottom of its own file.
`studio.html` never imports `input.js`, `ui.js` or `main.js`: it can't start the game loop, lock the pointer or show the HUD.

## Adding your own entities

Add objects to `entities` in `js/levelData.js` (or in Studio). Types: `vehicle`, `pickup`, `crate`, `barrel`, `ramp`, `block`, `prop`:

```js
{ id: 'my_block', type: 'block', name: 'Wall', pos: [10, 1, 20], rot: [0, 0, 0], scale: [4, 2, 4],
  texture: 'assets/textures/brick.png', texRepeat: [2, 2], color: '#94a3b8' }
```
Blocks, solid props, crates and barrels register collision boxes; ramps register drivable/walkable ramp surfaces
(aligned to the nearest 90 degree heading).
