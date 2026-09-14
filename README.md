# Cozy Cove

A stylised 3D cozy island life sim that runs in the browser. Fish the cove,
fill the museum, grow a garden, get to know four neighbours, and slowly make
the island somewhere worth living.

Built with **TypeScript**, **Three.js** and **Vite**. No art pipeline required:
the island, its buildings, its characters and every item icon are generated
from data at load time, so the whole game is a repository you can clone and run.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle into dist/
npm run preview  # serve the production build
```

Requires a browser with WebGL 2.

### Docker

```bash
docker compose up --build     # http://localhost:8080
```

A two-stage build: node compiles the bundle, nginx serves `dist/` with no
toolchain in the runtime image. `npm run build` typechecks first, so a type
error fails the image rather than shipping a broken bundle.

Cache headers are the part worth knowing about. Vite content-hashes its own
output but copies `public/` verbatim, so the two need opposite policies:
hashed bundle files are cached for a year as `immutable`, while the kit GLBs
and audio under `/assets/{models,audio,textures,fonts}/` are served
`no-cache` — revalidate, so a redeployed image reaches a browser that already
has them, at the cost of a 304. See `docker/nginx.conf`.

### Asset tooling

```bash
npm run assets:inspect -- public/assets/models/nature/nature.glb   # node names
npm run assets:verify                                              # GLB import path
npm run assets:credits                                             # regenerate ASSET_CREDITS.md
npm run assets:preview -- public/assets/models/nature/nature.glb docs/preview
npm run audio:verify                                               # positional-SFX downmix
```

`assets:preview` rasterises a kit to PNG with no browser and no dependencies,
using the same palette colours and flat shading the game binds and the scales
from `src/assets/manifest.ts`. It is how you see what a kit contains before it
is wired into a world system — and a tree whose canopy has come unstuck from
its trunk is obvious in a picture and subtle in a bounding box.

---

## Controls

| Action | Keyboard | Xbox-style pad |
| --- | --- | --- |
| Move | `W A S D` / arrows | Left stick |
| Interact / confirm | `E` | `A` |
| Use tool | `Space` | `X` |
| Run | `Shift` | `B` |
| Cancel / back | `Esc` | `B` |
| Backpack | `I` or `Tab` | `Y` |
| Map | `M` | View |
| Journal | `Q` | — |
| Settings | `F` | Menu |
| Cycle tool | `Z` / `C` | `LB` / `RB` |
| Orbit camera | `O` / `P` | Right stick |
| Zoom | `+` / `-` | `RT` / `LT` |
| Performance overlay | `F3` | — |

Touch controls (a virtual stick and four buttons) appear automatically on the
first touch input.

---

## Where things live

```
src/
  core/        Game orchestrator, typed event bus
  rendering/   renderer + post chain, sky, lighting rig, camera, particles, weather FX
  world/       heightfield, terrain, water, foliage, props, buildings, interiors, minimap
  player/      character rig, procedural animator, tools, movement controller
  npc/         navigation grid, villagers, schedules
  interactions/ contextual prompt system
  items/       item types, procedural icons and 3D models
  inventory/ museum/ fishing/ farming/ gathering/ shops/ quests/ relationships/ housing/
  audio/       four-channel mixer and the sound/music data tables
  input/       keyboard, gamepad and touch mapped onto logical actions
  time/        clock, seasons, weather
  save/        versioned schema, migrations, storage
  ui/          design system, HUD, dialogue, panels, portraits, title screen
  data/        species, items, furniture, clothing, villagers, recipes, quests
legacy/
  prototype-round5/   the original single-file canvas prototype, kept for reference
```

### The heightfield is the single source of truth

`src/world/heightfield.ts` defines the island as pure functions: `terrainHeight`,
`sampleSurface`, `isWalkable`, `waterDepth`, `shoreDistance`. Terrain meshing,
object scattering, player grounding, NPC pathfinding, the water shader's depth
texture and the map all read from it, so nothing can disagree about where the
ground is. Coastal landmarks (the pier, the dunes, the driftwood log) are
*measured* from the generated shoreline rather than hard-coded, so reshaping the
island moves them with it.

### Everything is data-driven

Species, items, furniture, clothing, villagers, dialogue, recipes, quests and
public works are typed tables under `src/data/`. Adding a fish is one entry; it
immediately appears in the fishing tables, the bag, the museum's aquarium wing,
the collection screen and the map of what is left to find.

---

## Replacing the placeholder art

The game ships with procedural assets so it is playable and coherent today.
Every one of them is behind a seam:

| Placeholder | Replace by |
| --- | --- |
| Item icons (`items/ItemIcons.ts`) | Set `ItemVisual.texture` on the item and load a sprite |
| Item / exhibit models (`items/ItemModels.ts`) | Load a GLB and return it from `makeItemModel` |
| Characters (`player/CharacterRig.ts`) | Parent a skinned GLTF to the same named joints; the animator is unchanged |
| Buildings (`world/BuildingKit.ts`) | Swap part builders for GLB props; placement in `Buildings.ts` stays |
| Sound effects (`audio/sounds.ts`) | Fill in `src` on the sound; the synth fallback is skipped |
| Music (`audio/sounds.ts`) | Fill in `src` on the track |

GLTF/GLB is the intended format for finished 3D assets.

---

## Saves and migration

Saves live in `localStorage` under `cozyCove.save.v5.slot{1..3}`.

`src/save/schema.ts` declares the current schema version and
`src/save/migrations.ts` holds one migration function per version step. On load
the save system detects the stored version, runs the chain, and writes the
upgraded blob back so a migration only ever runs once.

The round-5 prototype's saves (`cozyCoveSaveV4_slot*`, and the earlier
unnumbered `cozyCoveSaveV2`) are picked up automatically. Coins, day, season,
inventory, museum donations, friendships, requests, crops, tool levels,
backpack size, house style, owned and placed furniture, public works and story
stage all carry over; prototype pixel coordinates are converted to world metres
and crop growth is rescaled to the new four-stage cycle. Items with no matching
definition keep a synthetic id so they still show, stack and sell rather than
vanishing from a returning player's bag.

To add a version: bump `SAVE_VERSION`, write `migrate5to6`, register it in
`MIGRATIONS` under key `5`. Never edit a migration that has shipped.

---

## Performance

The renderer measures a rolling frame time and steps quality between `low`,
`medium` and `high`, adjusting pixel ratio, shadow map size, bloom, foliage
density and grass draw distance. Players can pin a level in Settings.

Foliage, props, crops, fish and paving are instanced; particles and item drops
are pooled; grass is chunked and distance-culled; terrain colour is baked into
vertices rather than sampled from textures. Season changes rewrite the colour
buffer instead of rebuilding geometry.

---

## What is finished, and what is not

The vertical slice — **Town Square → Beach → Player House**, plus the museum,
the store, the town hall and the lighthouse point — is built to the intended
visual bar: sculpted terrain with a real beach shelf, depth-aware ocean with
shoreline foam, instanced foliage that moves in the wind, procedural buildings
with doors, windows, signs, lamps and landscaping, a full day cycle with five
weather states, animated characters, walkable interiors, and the complete
interface.

Everything still outstanding is filed on the
[issue tracker](https://github.com/TheShield2594/Feegie-Tavern/issues), roughly
in these groups:

- **Gameplay not yet built** — diving (#1), insects as world entities (#2),
  outdoor landscaping (#4), multi-room housing (#5), tabletop placement (#6),
  festivals (#7), the regions outside the slice (#8), deeper quests and a
  second story chapter (#19)
- **Known bugs** — villagers never appear indoors (#3), unwired interaction
  hooks including doors and sleeping (#17), grass popping (#16), the rowboat
  hull (#15)
- **Assets** — a GLTF pipeline (#9) and recorded audio (#10); both have seams
  ready and neither has a loader yet
- **Content** — the catalogues are small enough to exhaust in a couple of
  in-game weeks (#11)
- **Engineering** — no automated tests (#12), LOD and lazy loading (#13), and
  a real device pass for tablets and phones (#14)

The architecture leaves space for each: regions are driven by the heightfield,
decorations by the same instancing used for foliage, and new species, recipes or
villagers are one typed entry apiece.
