# Asset Licences

The record of every third-party asset in Cozy Cove: who made it, where it came
from, what licence it carries, and what was done to it before it shipped. The
game deliberately uses **CC0 (public domain) art and audio only**; the one
exception is the UI font, under SIL OFL 1.1.

`ASSET_CREDITS.md` is the generated summary (`npm run assets:credits`). This
file is the human-maintained ledger of *modifications*, which a generator
cannot know. Update it whenever a kit is re-exported, re-tinted or re-scaled.

Original licence texts live, unedited, under `licenses/`.

## 3D model kits

| Asset | Creator | Source | Licence | Modifications |
| --- | --- | --- | --- | --- |
| Nature Kit (`public/assets/models/nature/nature.glb`) | Kenney | https://kenney.nl/assets/nature-kit | CC0 1.0 | 10 of ~330 models kept. Rebuilt into one meshopt-compressed GLB by `tools/buildKit.mjs`. Each tree split into `_trunk` / `_canopy` nodes so the game can bind its own bark and leaf materials; grounded and centred as a whole; scaled 3.2–4.2× at import (see `src/assets/manifest.ts`). Original textures dropped — rendered with the game's palette materials. |
| Fantasy Town Kit (`buildings/buildings.glb`) | Kenney | https://kenney.nl/assets/fantasy-town-kit | CC0 1.0 | 23 modular pieces kept. Shared colour atlas baked into per-vertex colours (`COLOR_0`); no texture shipped. Authored origins preserved. In this pass the fence piece is used for the garden picket run at 2.6× scale with a light tint. |
| Furniture Kit (`furniture/furniture.glb`) | Kenney | https://kenney.nl/assets/furniture-kit | CC0 1.0 | 20 models kept, atlas baked to vertex colours. Rendered through `createStylizedMaterial` with a soft palette tint per furniture definition (`softTint` in `src/assets/registry.ts`) so gameplay colourways still read; scaled 0.8–1.6× per placement. |
| Survival Kit (`props/props.glb`) | Kenney | https://kenney.nl/assets/survival-kit | CC0 1.0 | 18 models baked, vertex-coloured. Rocks scaled 3.3× (×0.7 per instance) as gatherable boulders; crates/barrels/chest/bucket at 0.55–1.3×; the log is rendered with a driftwood-grey palette material instead of its baked colour; the campfire pit carries a game-side ember light. Axe and shovel are held by the player at 0.82×. The `resource-wood` / `resource-stone` meshes remain in the GLB but are no longer referenced — the gatherable wood/stone drops moved to KayKit Resource Bits — so 16 of the 18 are in use. |
| Food Kit (`items/items.glb`) | Kenney | https://kenney.nl/assets/food-kit | CC0 1.0 | 16 models kept, vertex-coloured. Used for item drops and museum exhibits where an item genuinely matches (pumpkin, strawberry, pie, soup, dinner plate); recentred on import so drops spin about their middle. |
| Resource Bits (`resources/resources.glb`) | Kay Lousberg (KayKit) | https://kaylousberg.com/game-assets | CC0 1.0 | 2 of ~75 models kept — the log (`Wood_Log_A`) and stone chunks (`Stone_Chunks_Small`) for the `mat.wood` / `mat.stone` gatherable drops. Shipped as per-model `.gltf` + `.bin` + one shared 1024² atlas; the atlas is baked into per-vertex colours (`COLOR_0`) and dropped, grounded, centred and normalised to ~1 unit by `tools/buildKit.mjs` (through its new `.gltf` reader path). The ore, metal, fuel, cog and textile bits are not imported — no system consumes them. |
| LowPoly Animated Fish | Quaternius | https://quaternius.com/packs/animatedfish.html | CC0 | Declared in the manifest; **no file shipped yet** (see `docs/ASSET_PLAN.md` §9). |
| Animated Animals | Quaternius | https://quaternius.com/packs/ultimateanimatedanimals.html | CC0 | Declared; no file shipped yet. |
| Characters | Kay Lousberg (KayKit) | https://kaylousberg.com/game-assets | CC0 | Declared; no file shipped yet. Player and villager models remain the game's own procedural rigs. |

## Audio

| Asset | Creator | Source | Licence | Modifications |
| --- | --- | --- | --- | --- |
| `footstep_grass_000.ogg`, `footstep_carpet_000.ogg`, `footstep_wood_000.ogg`, `footstep_concrete_000.ogg` | Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 | Unchanged on disk; folded to mono at load for positional playback (`src/audio/downmix.ts`). Pitch-jittered per play. |
| `cloth3.ogg`, `chop.ogg` | Kenney | https://kenney.nl/assets/rpg-audio | CC0 1.0 | Unchanged on disk; mono at load. |
| `click_001.ogg`, `back_001.ogg` | Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 | Unchanged. |

Every other sound and all music is synthesised at runtime by
`src/audio/AudioSystem.ts` from the tables in `src/audio/sounds.ts` and has no
external source.

## Fonts

| Asset | Creator | Source | Licence | Modifications |
| --- | --- | --- | --- | --- |
| Nunito (variable, weights 200–1000) | Vernon Adams, Cyreal, Jacques Le Bailly | https://fonts.google.com/specimen/Nunito | SIL OFL 1.1 (`licenses/fonts-OFL.txt`) | Self-hosted as the unmodified variable TTF from `src/assets/fonts/`. Also rasterised into world-space nameplates and sign boards at runtime. |

## Everything else

Terrain, water, sky, weather, the player and villager characters, buildings,
the procedural surface textures (`src/rendering/textures.ts`), item icons,
UI icons and all interface art are generated by the game's own code and are
original to this project.
