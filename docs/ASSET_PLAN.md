# Cozy Cove — Free Asset Plan (for approval)

Status: **proposal only. Nothing has been downloaded.**

This plan covers sourcing free, redistributable assets for the browser life-sim
in PR #20 (`claude/cozy-cove-graphics-overhaul-391lkk`, "Scaffold
Three.js/TypeScript architecture for Cozy Cove").

---

## 1. What the game actually is (style baseline)

There was no game on `main` — it is an empty repo with a one-line README. The
real codebase is the **open, unmerged PR #20** (88 files, ~23.9k lines). The
plan below is written against that branch.

Read from the code, not guessed:

| Aspect | Finding | Source |
| --- | --- | --- |
| Stack | Vite 5 + TypeScript 5.6 + **three.js ^0.180**, `base: './'`, es2022, `three` split into its own chunk | `package.json`, `vite.config.ts` |
| Art direction | Hand-authored **stylised / painterly low-poly**. One global palette, deliberately: *"Every material pulls from here so the world reads as a single hand-painted set rather than a pile of unrelated meshes."* | `src/rendering/palette.ts` |
| Shading | `MeshStandardMaterial` patched with wind vertex displacement, wetness response and a **softened terminator "that reads as painted rather than photoreal"**; optional `flatShading` | `src/rendering/materials.ts` |
| Colour keys | grass `#7cb85f`, sand `#e8d3a8`, water shallow→deep `#59c2cf`/`#1d7fa8`/`#0f3f66`, wood plank `#c49a6c`, roof slate/terracotta/moss/plum, plaster cream `#f2e2c4` | `src/rendering/palette.ts` |
| Seasons | Global `SEASON_TINT` multiplies foliage/grass per season (Winter desaturates to 0.78) | `src/rendering/palette.ts` |
| Current assets | **Zero asset files.** Everything is procedural: `BuildingKit`, `Foliage`, `Props`, `CharacterRig`, `FurnitureModels`, `ItemModels`, `ItemIcons`, `portraits`. No `GLTFLoader`, no `TextureLoader` anywhere in `src/`. | `git grep` over the branch |
| Audio | Four-channel mixer; every sound is a **synthesised placeholder** behind a data table, with a documented swap path: *"Every entry can either point at a real file (`src`) or ... describe a small synthesised placeholder."* | `src/audio/sounds.ts`, `AudioSystem.ts` |
| Characters | Joint-named procedural rig (`shoulderL`, `kneeR`, `tail`, `earL`…). The architecture doc explicitly plans for this: *"when production GLTF characters arrive they can be parented to the same joint names and the animator does not change."* | `src/player/CharacterRig.ts`, `docs/ARCHITECTURE.md` |
| Icons | **Hand-drawn inline SVG**, explicitly *"Drawn rather than borrowed"* | `src/ui/icons.ts` |

**Consequence for "does the style match":** the game has no shipped art to match
*against* — it has a **written art direction** instead. So "style match" below
means *fits the palette + flat/painterly stylised low-poly direction the code
already commits to*, which is exactly the Kenney/Quaternius/KayKit house style.

**Two honest recommendations that fall out of this:**

1. **Icons: do not import a third-party icon set.** `src/ui/icons.ts` is a
   deliberate, cohesive, hand-drawn SVG set. Dropping in game-icons.net (CC-BY,
   woodcut silhouette style) would actively *reduce* cohesion and add an
   attribution obligation for no gain. Listed in §6 as rejected.
2. **Audio is the highest-value, lowest-risk win.** The `src` field already
   exists; swapping in real recordings is a pure data change with no gameplay
   code touched. Recommend starting the integration slice here.

---

## 2. Blocking constraint: this session cannot download any of it

Outbound HTTPS goes through a policy-enforcing egress proxy. I verified
reachability directly:

| Host | Result |
| --- | --- |
| `github.com`, `raw.githubusercontent.com` | ✅ reachable |
| `kenney.nl` | ❌ EGRESS_BLOCKED |
| `quaternius.com` | ❌ EGRESS_BLOCKED |
| `kaylousberg.com`, `kaylousberg.itch.io`, `itch.io` | ❌ EGRESS_BLOCKED |
| `poly.pizza` | ❌ EGRESS_BLOCKED |
| `opengameart.org` | ❌ EGRESS_BLOCKED |
| `freesound.org` | ❌ EGRESS_BLOCKED |
| `polyhaven.com` | ❌ EGRESS_BLOCKED |
| `pixabay.com` | ❌ EGRESS_BLOCKED |
| `archive.org` | ❌ EGRESS_BLOCKED |
| `fonts.google.com` | ❌ EGRESS_BLOCKED |

Per the proxy's own documentation a 403/407 is an **organization policy denial**
that must be reported rather than routed around, so I have not attempted any
workaround.

**Therefore the pack metadata below (asset counts, file sizes) comes from web
search results, not from my own inspection of the download pages.** Every such
figure is marked *(unverified)* and must be confirmed against the official page
at download time. Licenses are stated from well-established, consistent public
information, but the authoritative check is the `License.txt` inside each
archive — which is exactly what step 1 of §7 does before anything is committed.

### Decision: option A — allowlist the official hosts

Approved 2026-09-14. The following need to be added to the environment's egress
policy so assets can be fetched from their **official** sources:

```
kenney.nl
quaternius.com
kaylousberg.com
*.itch.io
freesound.org
polyhaven.com
ambientcg.com
fonts.google.com
fonts.gstatic.com
```

**Status: not yet in effect.** Re-checked `kenney.nl` and `quaternius.com` on
2026-09-14 — both still return EGRESS_BLOCKED. This is an environment
configuration change that has to be made outside this session; I cannot make it
myself, and per the proxy's documentation I will not attempt to route around it.

Because option A was chosen, the third-party GitHub mirrors are **off the
table** — everything comes from the creator's own download page, so the
`License.txt` in each archive is authoritative.

---

## 3. The asset plan

Preview column: I could not load preview images (hosts blocked), so it describes
the pack's look instead of showing it.

### 3.1 Environment, buildings, props — primary

| # | Asset | Source / creator | Asset page | License & attribution | Format & est. size | Where used | Style match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Nature Kit** — trees, rocks, terrain pieces, fence, tent, canoe, waterfall, statue. ~330 assets *(unverified)* | Kenney | https://kenney.nl/assets/nature-kit | **CC0 1.0** — no attribution required | glTF/GLB, OBJ, FBX · ~10–20 MB zip *(unverified)* | `world/Foliage.ts`, `world/Props.ts`, `world/Terrain.ts` dressing | ★★★★★ Flat-shaded, saturated, matches `PALETTE.foliage` closely |
| 2 | **Fantasy Town Kit** — modular walls, roofs, doors, windows, market stalls. ~160 assets *(unverified)* | Kenney | https://kenney.nl/assets/fantasy-town-kit | **CC0 1.0** | glTF/OBJ/FBX · ~15 MB *(unverified)* | `world/BuildingKit.ts`, `world/Buildings.ts` — tavern, shops | ★★★★★ Cream plaster + coloured roofs is literally `PALETTE.plaster`/`PALETTE.roof` |
| 3 | **Furniture Kit** — 140 assets: chairs, sofas, tables, beds, kitchen, bathroom *(unverified)* | Kenney | https://kenney.nl/assets/furniture-kit | **CC0 1.0** | glTF/OBJ/FBX · ~6 MB *(unverified)* | `housing/FurnitureModels.ts`, `world/InteriorKit.ts`, `world/Interiors.ts` | ★★★★★ Direct replacement for procedural furniture |
| 4 | **Survival Kit** — 80 assets: campfire, tools, crates, barrels, lantern *(unverified)* | Kenney | https://kenney.nl/assets/survival-kit | **CC0 1.0** | glTF/OBJ/FBX · **1.8 MB** *(unverified)* | `world/Props.ts`, `player/Tools.ts` | ★★★★★ |
| 5 | **Food Kit** — 200 assets: produce, cooked dishes, drinks *(unverified)* | Kenney | https://kenney.nl/assets/food-kit | **CC0 1.0** | glTF/OBJ/FBX · **4.3 MB** *(unverified)* | `items/ItemModels.ts`, `data/recipes.ts`, tavern service | ★★★★☆ Slightly glossier; re-tint to palette |
| 6 | **Ultimate Stylized Nature Pack** — 110+ "Ghibli-inspired" nature models *(unverified)* | Quaternius | https://quaternius.com/packs/ultimatestylizednature.html | **CC0** | glTF, FBX, OBJ, .blend | Hero trees / focal vegetation where Kenney reads too blocky | ★★★★☆ Softer and more painterly — good for hero pieces, mix carefully |

### 3.2 Characters, NPCs, wildlife, fishing

| # | Asset | Source / creator | Asset page | License & attribution | Format & est. size | Where used | Style match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7 | **KayKit Character Pack(s)** — rigged, animated, gradient-atlas characters | Kay Lousberg | https://kaylousberg.com/game-assets · https://kaylousberg.itch.io | **CC0** — no attribution required | FBX + **glTF**, .blend source · 1024² atlas (downsamplable to 128²) | `npc/Villager.ts`, `player/Player.ts` — the eventual replacement for `CharacterRig` | ★★★★★ Best-in-class cozy stylisation; gradient atlas is ideal for the palette |
| 8 | **KayKit Character Animations** — standalone animation library | Kay Lousberg | https://kaylousberg.itch.io/kaykit-character-animations | **CC0** — no attribution required | FBX / glTF | Feeds `player/CharacterAnimator.ts` | ★★★★★ CC0 alternative to Mixamo (see §6) |
| 9 | **Ultimate Animated Animal Pack** | Quaternius | https://quaternius.com/packs/ultimateanimatedanimals.html | **CC0** | FBX, OBJ, .blend, glTF · Idle/Walk/Run/Jump/Death clips | Island wildlife, `gathering/DropSystem.ts` | ★★★★☆ |
| 10 | **LowPoly Animated Fish** — 7 rigged swimming fish *(unverified count)* | Quaternius | https://quaternius.com/packs/animatedfish.html | **CC0** | FBX, OBJ, glTF, .blend | `fishing/FishSchools.ts`, `fishing/FishingSystem.ts`, `ui/CatchCard.ts`, `museum/Museum.ts` | ★★★★☆ Needs palette re-tint to sit in `PALETTE.water` |
| 11 | **KayKit Resource Bits** — ore, logs, crops, gatherables | Kay Lousberg | https://kaylousberg.itch.io/resource-bits | **CC0** | FBX / glTF | `gathering/DropSystem.ts`, `farming/Farm.ts`, `inventory` | ★★★★★ |

### 3.3 Audio — SFX, ambience, music

| # | Asset | Source / creator | Asset page | License & attribution | Format & est. size | Where used | Style match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 12 | **RPG Audio** — 50 assets *(unverified)* | Kenney | https://kenney.nl/assets/rpg-audio | **CC0 1.0** | OGG · ~5 MB *(unverified)* | `sounds.ts`: `tool.*`, gathering, inventory | ★★★★★ |
| 13 | **Interface Sounds** — 100 OGG files *(unverified)* | Kenney | https://kenney.nl/assets/interface-sounds | **CC0 1.0** | OGG · ~3 MB *(unverified)* | `sounds.ts` `ui` channel: panels, confirm, cancel | ★★★★★ |
| 14 | **Impact Sounds** — 130 assets *(unverified)* | Kenney | https://kenney.nl/assets/impact-sounds | **CC0 1.0** | OGG · ~4 MB *(unverified)* | Footsteps (`step.grass/sand/wood/stone`), drops, thuds | ★★★★★ |
| 15 | **FREE Music Loop Bundle** — 200+ seamless loops, repeatedly described as cozy | Tallbeard Studios | https://tallbeard.itch.io/music-loop-bundle | **CC0** (relicensed to CC0 per the pack's "More songs! Better license!" devlog — **verify on download**) | OGG/WAV/MP3 · large; **cherry-pick 4–6 loops only** | `sounds.ts` `music` channel — day / evening / shop / rain themes | ★★★★★ |
| 16 | **Ambience: water, wind, birds, fire, rain** | Freesound (per-sound) | https://freesound.org | ⚠️ **Mixed per sound.** Filter to **CC0 only**; CC-BY acceptable *with* recorded attribution. **Exclude every CC-BY-NC / sampling-plus.** | WAV → transcode to OGG | `AudioSystem` ambience channel, `WeatherSystem` | ★★★★☆ Must be curated one file at a time |

### 3.4 Supporting

| # | Asset | Source / creator | Asset page | License & attribution | Format & est. size | Where used | Style match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | **HDRI sky/environment** (e.g. a soft overcast + a golden-hour) | Poly Haven | https://polyhaven.com/hdris | **CC0** | HDR/EXR → bake to compressed env map at **1k or lower** | IBL for `rendering/Renderer.ts`; `Sky.ts` keeps its shader | ★★★☆☆ Photoreal source, but used only as lighting, never visible |
| 18 | **Stylised tiling textures** (wood, plaster, thatch, sand) | ambientCG | https://ambientcg.com | **CC0** | PNG/JPG → KTX2 | `materials.ts` detail maps | ★★★☆☆ Use sparingly — flat colour is the current look |
| 19 | **UI font** (e.g. Quicksand / Nunito / Baloo 2) | Google Fonts | https://fonts.google.com | **SIL OFL 1.1** — self-host, ship `OFL.txt` | WOFF2 · ~30 KB subset | `ui/styles.css` | ★★★★★ Rounded geometric sans suits cozy |

---

## 4. Proposed folder layout

```
public/assets/
  models/
    nature/        buildings/     furniture/
    props/         characters/    fish/          animals/
  audio/
    sfx/           ui/            ambience/      music/
  textures/
    env/           surfaces/
  fonts/
licenses/
  kenney-CC0.txt
  quaternius-CC0.txt
  kaykit-CC0.txt
  tallbeard-CC0.txt
  polyhaven-CC0.txt
  ambientcg-CC0.txt
  freesound/<sound-id>-<license>.txt
  fonts-OFL.txt
ASSET_CREDITS.md
```

Rules: every pack's original `License.txt` is preserved verbatim under
`licenses/` — never edited, never summarised away. `ASSET_CREDITS.md` is the
human-readable index (source, creator, URL, license, whether attribution is
*required*), generated from the same data and kept in sync.

---

## 5. Browser optimisation pipeline

The game already ships `three` as a separate chunk and targets es2022, so assets
are the next payload concern. Per asset:

1. **Prune first.** Import only the models actually placed — not all 330 nature
   pieces. Target: a few dozen meshes, not a library dump.
2. **glTF → GLB**, then **`gltf-transform`**: `dedup`, `prune`, `weld`,
   `resample`, `draco` (or `meshopt`) compression. Typically 70–90% off.
3. **Merge kits into atlased bundles** — one GLB per category
   (`nature.glb`, `buildings.glb`) rather than hundreds of fetches. These packs
   share one material per kit, which makes this cheap.
4. **Textures → KTX2/Basis**; cap env maps at 1k; strip unused channels.
   Drop textures entirely where a palette colour does the job.
5. **Audio → OGG Vorbis** (~q4 for SFX, ~q5 for music), mono for positional SFX,
   loop points trimmed to sample-accurate.
6. **Budget:** first-load ≤ ~8 MB; lazy-load interiors, music beyond the first
   track, and museum/fish models behind their systems.
7. Add `GLTFLoader` + Draco/KTX2 decoders as the first asset-loading code the
   project has, behind a small `AssetManager` with a loading screen hook.

---

## 6. Explicitly rejected

| Rejected | Why |
| --- | --- |
| **Mixamo** animations | Account-bound Adobe licence; redistributing the animation files in a public repo is not clearly permitted. KayKit Animations (#8) is the CC0 equivalent. |
| **Pixabay** audio/models | Pixabay Content License is *not* CC0 and restricts redistribution of assets "as-is"; ambiguous for a git repo. |
| **Zapsplat** | Free tier demands attribution *and* forbids redistribution. |
| **Sketchfab** general browsing | Per-model licences, many CC-BY-NC or NoDerivatives; not worth the per-asset audit. |
| **game-icons.net** | CC-BY (attribution obligation) *and* a woodcut style that clashes with the hand-drawn `ui/icons.ts` set. Cohesion loss for no benefit. |
| Anything ripped from a shipped game, "editorial only", NC, or ND | Excluded by your brief and by law. |
| Any asset with unclear/unstated licensing | Excluded on principle. |

---

## 7. Execution order, once unblocked

1. **Verify before committing anything.** Download from the official page →
   open each `License.txt` → confirm CC0 → only then commit. Anything whose
   licence does not match this plan gets dropped and reported, not quietly
   included.
2. Land `licenses/` + `ASSET_CREDITS.md` in the same commit as the assets.
3. **Build the loading layer that does not exist yet.** `AssetManager` wrapping
   `GLTFLoader` + Draco/KTX2 decoders, with a loading-screen hook. This is
   genuinely new code — the project has never loaded a file.
4. **Representative slice first**, to prove the pipeline before the wholesale
   swap:
   - **Audio (highest value, zero code risk):** fill in the existing `src`
     field for ~8 SFX — 4 footsteps, `tool.cast`, `tool.splash`, 2 UI — plus
     one cozy music loop. No gameplay code changes at all.
   - **Models:** one optimised `nature.glb` (≈10 trees/rocks/bushes) driving
     `world/Foliage.ts`, palette-tinted.
   - **One fish** through `FishSchools` → `CatchCard` to prove the fishing path.
5. Measure bundle size + frame time before/after; report the numbers.
6. **Then replace, category by category** (see §7.1), each behind its own
   commit and review.

### 7.1 Replacement strategy (decision 3: replace, not augment)

The procedural generators are being retired, not kept alongside. Two properties
of the current code must survive the swap, or the world will visibly regress:

| Property to preserve | Where it lives now | How it survives |
| --- | --- | --- |
| **Season reactivity** — `SEASON_TINT` desaturates and recolours foliage per season (Winter → 0.78 saturation) | `rendering/palette.ts`, `materials.ts` shared uniforms | Imported meshes must use `createStylizedMaterial`, **not** the GLTF's own materials. Strip incoming materials at load and re-bind to the shared uniform set. |
| **Wind displacement** — two-frequency sway driven by `uTime`/`uWind`, with per-vertex stiffness | `materials.ts` `applyWind` | Needs a stiffness attribute. Kenney/Quaternius meshes have no such channel, so generate it at import time from normalised local Y (0 at base, 1 at tip). |
| **Wetness response** | `materials.ts` `uWetness` | Comes free once materials are re-bound. |
| **Instancing** — foliage is drawn instanced | `world/Foliage.ts` | Keep the instancing path; swap only the source geometry. |
| **Palette cohesion** | `rendering/palette.ts` | Re-tint imported albedo toward the palette rather than shipping pack colours, so the kits still read as one set. |

Order of replacement, easiest and most reversible first:
`Foliage` → `Props` → `BuildingKit`/`Buildings` → `InteriorKit`/`FurnitureModels`
→ `ItemModels` → `CharacterRig` (last, and the riskiest: the animator drives
named joints, so KayKit rigs must be retargeted to the existing `JointName` set
rather than the reverse).

`src/ui/icons.ts` and `src/ui/portraits.ts` are **not** in scope for replacement
— they stay hand-drawn (see §6).

## 8. Decisions (locked 2026-09-14)

1. **Unblock method — A.** Allowlist the official hosts. Blocked on the
   environment change; GitHub mirrors are consequently out of scope.
2. **Branching — wait for PR #20 to merge.** No integration work starts, and
   this branch is not rebased, until `claude/cozy-cove-graphics-overhaul-391lkk`
   lands on `main`. Until then this repo has no game to integrate into.
3. **Replace**, not augment. See §7.1 for what must be preserved through the
   swap.
4. **Licensing — strict CC0 for all shipped art and audio.** My call, given the
   brief said "prefer CC0 or similarly unrestricted". Rationale: every pack in
   §3.1–§3.3 is already CC0, so accepting CC-BY would buy nothing while adding
   a permanent, per-asset obligation that has to survive every future refactor.
   Concretely:
   - Models, textures, SFX, music: **CC0 only.** No exceptions.
   - Freesound ambience (#16): filter to **CC0 only**; drop the CC-BY
     candidates rather than carry attribution for ambience that a CC0
     recording can supply just as well.
   - **One deliberate exception:** the UI font under **SIL OFL 1.1** (#19).
     OFL is not CC0 but is unrestricted for this use; it requires shipping
     `OFL.txt` alongside the font, which costs nothing and is standard practice.
   - `ASSET_CREDITS.md` is still produced in full — crediting creators is right
     even where no licence compels it. It will simply record
     "attribution: not required" for everything except the font.

## 9. Current blockers

| Blocker | Owner | Needed for |
| --- | --- | --- |
| Egress allowlist not yet in effect (§2) | You / environment config | Any download at all |
| PR #20 not yet merged | You | Any integration work (decision 2) |

Nothing further can proceed in this session until at least the first clears.
