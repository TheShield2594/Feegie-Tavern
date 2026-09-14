# Cozy Cove — Free Asset Plan (for approval)

Status: **approved and in progress.** The first CC0 assets have been downloaded,
licence-checked and committed — see §9 for what landed, what was dropped and
why, and what is still blocked. §1–§8 are the approved plan and are left as
written; where §2's egress findings have since been overtaken by events, §9 is
the current record.

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

> **Superseded 2026-09-14 — kept as the record of why option A was chosen.** The
> allowlist below has since been applied and the asset hosts are reachable; the
> per-host results in this section are no longer current. §9.1 has the live
> table, and §9.4 records the one source host still denied. The *decisions* in
> this section stand unchanged: downloads come from the creator's own page, and
> GitHub mirrors remain out of scope.

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
A later host-by-host re-test of this whole list is recorded in §9.

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
| **Wind displacement** — two-frequency sway driven by `uTime`/`uWind` | `materials.ts` `applyWind` | **Correction to the first draft of this plan:** no vertex attribute is needed. `createStylizedMaterial` derives stiffness *in the shader* from `uv.y` (grass) or `transformed.y` (foliage/canopy), so an imported mesh works as-is **provided its origin sits at the base** — which is exactly what `normalizeGeometry`'s `groundOrigin` guarantees. |
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

## 9. Status

Rewritten 2026-09-14 after the first session in which assets could actually be
downloaded. **The egress allowlist is now in effect and the first CC0 assets have
landed.** Two of the three representative-slice items from §7 step 4 are done;
the third is blocked on a source host, and the §7 step 5 measurement is blocked
on the toolchain. Details below, including everything that did *not* work.

| Blocker | State |
| --- | --- |
| PR #20 merged to `main` | ✅ **Cleared** 2026-09-14 (`cc5be5d`). |
| Egress allowlist (§2) | ✅ **Cleared** for every host §3 depends on except Quaternius'. |
| npm registry | ❌ **New blocker.** `registry.npmjs.org` is denied, so the project's dependencies cannot be installed and `typecheck`/`build`/`assets:verify` cannot run. |

### 9.1 Egress re-test, 2026-09-14 (allowlist environment)

Re-tested host by host before anything else. Compare with the all-403 table
earlier in this section — the allowlist has been applied:

| Host | Result | Note |
| --- | --- | --- |
| `kenney.nl` | ✅ 200 | Assets #1–#5, #12–#14 |
| `quaternius.com` | ✅ 200 | Page loads, but see §9.4 — downloads do not |
| `kaylousberg.com` | ✅ 200 | |
| `kaylousberg.itch.io` | ✅ reachable (429 rate-limit, not a policy denial) | |
| `tallbeard.itch.io` | ✅ 200 | |
| `itch.io` (bare domain) | ❌ 403 | Only the bare domain; the `*.itch.io` subdomains the plan actually needs are open, so this does not block anything |
| `freesound.org` | ✅ 200 | Site reachable; API needs credentials — see §9.4 |
| `polyhaven.com` | ✅ 200 | |
| `ambientcg.com` | ✅ 200 | |
| `fonts.google.com` | ✅ 200 | |
| `fonts.gstatic.com` | ✅ reachable (404 on `/`, 200 on a real WOFF2 path) | |

### 9.2 Licences read and confirmed

Every pack below was downloaded from the creator's own page in §3 — no GitHub
mirror, per §8 decision 1 — and its `License.txt` was opened and read from
inside the archive before anything was committed. The four files are preserved
verbatim under `licenses/`, each verified byte-identical (SHA-256) to the copy
in its archive.

| Pack | Source | Operative line, quoted from the archive's `License.txt` |
| --- | --- | --- |
| Nature Kit 2.1 | `kenney.nl/assets/nature-kit` | `License: (Creative Commons Zero, CC0)` — "This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)" |
| RPG Audio | `kenney.nl/assets/rpg-audio` | `License (Creative Commons Zero, CC0)` — "You may use these assets in personal and commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not mandatory." |
| Interface Sounds 1.0 | `kenney.nl/assets/interface-sounds` | `License: (Creative Commons Zero, CC0)` — "This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)" |
| Impact Sounds 1.0 | `kenney.nl/assets/impact-sounds` | `License: (Creative Commons Zero, CC0)` — "This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)" |
| Food Kit 2.0 | `kenney.nl/assets/food-kit` | `License: (Creative Commons Zero, CC0)` — "You can use this content for personal, educational, and commercial purposes. Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)" |
| Furniture Kit 2.0 | `kenney.nl/assets/furniture-kit` | `License: (Creative Commons Zero, CC0)` — "This content is free to use in personal, educational and commercial projects. Support us by crediting Kenney or www.kenney.nl (this is not mandatory)" |
| Survival Kit 2.0 | `kenney.nl/assets/survival-kit` | `License: (Creative Commons Zero, CC0)` — "You can use this content for personal, educational, and commercial purposes. Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)" |
| Fantasy Town Kit 2.0 | `kenney.nl/assets/fantasy-town-kit` | `License: (Creative Commons Zero, CC0)` — "You can use this content for personal, educational, and commercial purposes. Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)" |

All eight match §8 decision 4 (strict CC0). Nothing was committed on the strength
of a download page alone.

Kenney ships a separate `License.txt` per pack, identical in grant but differing
in pack name, version and date. They are kept as one file per pack rather than a single
`kenney-CC0.txt`, because merging them would mean editing licence text.

### 9.3 What landed

**Audio — 8 CC0 sound effects (§7 step 4, first bullet).** Files under
`public/assets/audio/{sfx,ui}/`, keeping Kenney's original filenames so any
sound can be traced back to its pack and licence file. Already OGG Vorbis at
source, so no transcode was needed.

| `sounds.ts` id | File | Pack | Match |
| --- | --- | --- | --- |
| `step.grass` | `footstep_grass_000.ogg` | Impact Sounds | exact |
| `step.sand` | `footstep_carpet_000.ogg` | Impact Sounds | **approximate** — the pack has no sand recording; carpet is its muffled soft-ground step |
| `step.wood` | `footstep_wood_000.ogg` | Impact Sounds | exact |
| `step.stone` | `footstep_concrete_000.ogg` | Impact Sounds | near-exact (concrete for stone) |
| `tool.cast` | `cloth3.ogg` | RPG Audio | **approximate** — no whoosh in any of the three packs; a cloth swish is the nearest thing to a rod whip |
| `tool.axe` | `chop.ogg` | RPG Audio | exact |
| `ui.select` | `click_001.ogg` | Interface Sounds | exact |
| `ui.back` | `back_001.ogg` | Interface Sounds | exact |

The two approximations are flagged rather than presented as finished: they are
placeholders of better quality than the synth, not final choices.

**A gap in this plan's own premise, found while doing it.** §7 step 4 says
filling `src` needs "no gameplay code changes at all". That was not true:
`AudioSystem.loadBuffer` existed but **nothing in the codebase called it**, so
`src` was inert and every sound would have kept playing its synth placeholder.
Fixed by adding `AudioSystem.preloadSources()`, which walks `SOUNDS` for entries
with a `src` and loads them after the context unlocks. The claim now holds going
forward — the *next* sound really is a one-line data change — and the failure
mode is still the documented one: a file that is missing or fails to decode
leaves the placeholder playing rather than producing silence.

**Models — `nature.glb` (§7 step 4, second bullet, partially).** 10 nodes,
1,912 vertices, 1,038 triangles, **58,984 bytes**, built from the Nature Kit by
`tools/buildNatureKit.mjs`:

| Node | Verts | Tris | | Node | Verts | Tris |
| --- | --- | --- | --- | --- | --- | --- |
| `tree_default_trunk` | 116 | 74 | | `tree_palmDetailedTall_trunk` | 72 | 36 |
| `tree_default_canopy` | 76 | 40 | | `tree_palmDetailedTall_canopy` | 568 | 300 |
| `tree_oak_trunk` | 210 | 130 | | `plant_bushDetailed` | 232 | 104 |
| `tree_oak_canopy` | 114 | 64 | | `plant_bushLarge` | 132 | 60 |
| `tree_pineDefaultA_trunk` | 84 | 50 | | | | |
| `tree_pineDefaultA_canopy` | 308 | 180 | | | | |

`src/assets/manifest.ts` `MODELS` is filled in from **these exact node names,
read back out of the built file** — see §9.5 for how, given that
`npm run assets:inspect` could not run.

Optimisations applied (§5), and what each was worth:

- **Pruned** to 6 source models out of the kit's 329; the rest are never opened.
- **Split by material name, not primitive index.** A Kenney tree is one mesh of
  two primitives sharing a vertex buffer — bark and leaves. The kit is *not*
  consistent about their order (`tree_default` is bark-first, `tree_oak` is
  leaves-first), so splitting by index would have silently swapped some trunks
  and canopies. Roles are resolved from the material name instead.
- **Welded/compacted** per output primitive, so the bark geometry stops carrying
  the leaf vertices it never indexes.
- **Stripped** `TEXCOORD_0` and all materials. The kit is untextured (flat
  `baseColorFactor`), and §7.1 requires re-binding to `createStylizedMaterial`
  anyway, so the palette supplies colour and the UVs are dead weight. Canopy and
  foliage wind derive stiffness from `transformed.y`, not `uv`, so dropping UVs
  costs nothing. (Grass, which *does* use `uv.y`, is not in this kit.)
- **Narrowed indices** from UINT32 to UINT16.
- **Grounded once per whole model**, moving trunk and canopy together. This is
  why every `MODELS` entry sets `groundOrigin: false` and `centreXZ: false`:
  letting `normalizeGeometry` ground each node independently would drop each
  canopy to y = 0 and take the trees apart.

`scale` in each entry brings the kit (authored 1–1.7 units tall) up to the
dimensions of the procedural geometry it replaces, so `Foliage`'s existing
placement rules and per-instance scale ranges keep working.

### 9.4 Dropped, and why

Nothing below was quietly substituted or padded out with a near-enough asset.

- **Quaternius — Animated Fish (#10), Stylized Nature (#6), Animated Animals
  (#9): dropped, egress.** `quaternius.com` is reachable, but every pack page
  routes its download to a `drive.google.com` folder, and
  `drive.google.com` / `drive.usercontent.google.com` both answer **403 at
  CONNECT** — the proxy's own log classifies this as an organization policy
  denial, so per §2 it is reported rather than routed around. Quaternius hosts
  no file on its own domain. **This is what blocks the third slice item — "one
  fish through `FishSchools` → `CatchCard`" — entirely:** #10 is the plan's only
  fish, and no other approved source in §3 has one. Substituting a pack §3 does
  not list would be a source change, which is not mine to make.
  *Also worth recording for whenever this unblocks:* the pack page states "FBX,
  OBJ and Blend formats" only. §3 lists glTF for it — that was an *(unverified)*
  guess and it is wrong, so this pack will need a conversion step the plan does
  not currently budget for.
- **Tallbeard — Music Loop Bundle (#15): dropped, permission.** Its CC0
  relicensing claim **does check out** on the creator's own page — an explicit
  waiver, "To the extent possible under law, Abstraction Music and Tallbeard
  Studios has waived all copyright and related or neighboring rights to the
  music contained in this asset pack", with commercial use and modification
  permitted. (The page also asks, explicitly "although permitted within the
  license terms", that the assets not be used for NFTs, AI/ML or resale of
  unmodified assets — a request, not a licence condition. Nothing here conflicts
  with it.) The download itself could not be completed: itch.io serves
  "name your own price" packs only through its checkout flow, and this session's
  permission layer blocked that as a real-world transaction. No workaround was
  attempted. Since §7 step 1 requires reading the licence *inside the archive*
  and there is no archive, dropping it is doubly correct. **One cozy music loop
  is therefore missing from the audio slice.**
- **`tool.splash`: no asset, placeholder kept.** None of the three approved
  Kenney audio packs contains a water or splash recording — verified by listing
  every sound family in all three. §3 #12 claims RPG Audio covers `tool.*`;
  for splash it does not.
- **Freesound ambience (#16): not started.** `freesound.org` is reachable, but
  its API answers `Authentication credentials were not provided.` and file
  downloads redirect to a login page. Fetching anything needs an account and an
  API key, which this session has neither of and should not create. Nothing was
  downloaded, so the CC0-only filter in §8 decision 4 has not yet been applied
  to anything.
- **UI font (#19), Poly Haven (#17), ambientCG (#18), KayKit (#7, #8, #11): not
  started.** All reachable now; simply out of scope for the representative
  slice. Note that `fonts.google.com` being open resolves the licence problem
  recorded earlier in this section: the `OFL.txt` can now be fetched, so #19 is
  no longer blocked on licence verification.

### 9.5 Verification — what was checked, and what could not be

**`npm run typecheck`, `npm run build` and `npm run assets:verify` did not run.**
`registry.npmjs.org` answers **403 to every request**, both directly and forced
through the agent proxy, which the proxy logs as an organization policy denial.
`node_modules/` is empty and `npm install` fails on the first tarball;
`npm install --offline` fails with `ENOTCACHED`. `three`, `@types/three`, `tsx`
and `vite` are not present anywhere on the machine and cannot be fetched. Per the
proxy's documentation this was reported rather than routed around — in
particular, no attempt was made to pull `three` or `vite` from a CDN to sidestep
the registry block.

Consequences, stated plainly:

- **Bundle size before/after could not be measured.** The §7 step 5 comparison
  against the baseline below is **not** in this update, because `vite build`
  cannot run. Nothing was estimated in its place.
- **Frame time could not be measured**, for the same reason.
- `npm run assets:inspect` could not run either, so node names were read with a
  purpose-built plain-Node GLB parser instead of three's `GLTFLoader`. The names
  in `MODELS` come from the built file, not from guesswork — but they have not
  been round-tripped through the loader the game will actually use, which is the
  one residual risk in this commit.

What *was* verified:

- **The GLB, structurally and geometrically.** A plain-Node validator parsed the
  built file and checked: GLB magic/version, header length against file length,
  chunk 4-byte alignment, exactly two chunks, buffer-view alignment and bounds,
  declared accessor `min`/`max` against the actual vertex extents, index range
  within vertex count, index count divisible by 3, finite normals, UINT16
  indices, no TEXCOORD, no materials or textures, unique node names, one
  primitive per mesh, and `mesh.name === node.name` for every node. All 18
  structural checks pass. Then per model: base at y = 0, centred on XZ, and
  canopy above trunk — 15 further checks, all passing, on all 6 models.
- **Every `src` path resolves** to a real file under `public/`. All 8.
- **Licence files are byte-identical** to the copies inside the archives
  (SHA-256, all 4).
- **Types, partially.** `src/audio/AudioSystem.ts`, `src/audio/sounds.ts`,
  `src/assets/manifest.ts` and `tools/genCredits.ts` typecheck clean. This is a
  genuine check — none of those four files imports `three` — but it is **not**
  equivalent to `npm run typecheck`: it ran under the machine's global
  TypeScript **6.0.2** rather than the pinned ^5.6.3, with `vite/client` and
  `@types/node` stubbed, and it covers only those four files. The rest of `src/`
  was not typechecked.
- **`ASSET_CREDITS.md` was regenerated by the project's own
  `tools/genCredits.ts`**, not hand-edited (run under `node
  --experimental-strip-types` with a small resolve hook standing in for `tsx`).

While regenerating it, the generator was found to **hardcode its audio table**,
so it credited Tallbeard's music bundle — a pack that has never shipped — and
would have kept doing so. It now derives that table from `SOUNDS`, listing only
packs the game actually plays a file from, and **exits non-zero if a shipped
sound has no pack entry**, so an uncreditable, untraceable sound cannot slip in.

### 9.5b Mono fold-down for positional SFX (added after the first commit)

Context that arrived after the assets landed: **this is headed for a self-hosted
multiplayer build**, browser-only testing first. That does not change a single
licence — CC0 covers a server redistributing assets to clients with no
obligation, which is §8 decision 4 earning its keep — but it does promote one
item in §5 from nice-to-have to required.

A `PannerNode` spatialises a **mono** source. The shipped effects measure:

| File | Channels | |
| --- | --- | --- |
| `footstep_grass/wood/concrete/carpet_000.ogg`, `cloth3.ogg`, `chop.ogg` | 2 | positional — must fold down |
| `click_001.ogg`, `back_001.ogg` | 1 | UI, non-positional — already mono |

Exactly the six that will be positioned are stereo. Fed to a panner as-is, their
own stereo image fights the panner's placement and a footstep meant to come from
a point on the island smears across both ears. There is no spatial audio in the
codebase yet (no `PannerNode` anywhere; `playBuffer` connects straight to the
channel gain), so this is preparation — but the files are on disk now and doing
it later means revisiting every one.

**The transcode blocker in §9.5 does not apply here.** That blocker is real for
re-encoding files on disk (no ffmpeg, no `oggenc`). The fold-down instead happens
once at load, in `loadBuffer`, after `decodeAudioData` — so it needs no tooling
at all, and it halves the decoded footprint of every positional effect today.

Which sounds fold down is data, not a heuristic: `SoundDef.mono` in `sounds.ts`,
set on those six. Non-positional sounds (UI, music, ambience, and `thunder`,
which is on the `sfx` channel but is not a point source) keep the width they
were recorded with.

`mixToMono` lives in its own module taking `Float32Array`s rather than an
`AudioBuffer`, specifically so it can be tested without a browser —
`npm run audio:verify`, and it **was run**: 10 checks, all passing. They cover
the quiet failures (a fold-down that halves amplitude on correlated material,
or overruns a shorter destination) plus NaN safety, since one NaN sample
poisons the graph and silences the whole mixer rather than one sound. Two of
the ten check the data instead of the maths: no sound is flagged `mono` without
a `src`, and nothing off the `sfx` channel is flagged.

### 9.5c Looking at it — `npm run assets:preview`

The game cannot be screenshotted in this environment: `vite` and `three` are
unavailable, so it does not build, let alone run. What *can* be shown is the
geometry itself, so `tools/renderKit.mjs` rasterises a kit GLB straight to PNG —
no browser, no dependencies, z-buffer and flat shading in plain node, PNG
written via `node:zlib`.

It is deliberately faithful rather than pretty: face normals, because
`Foliage`'s bark, canopy, pine and bush materials all set `flatShading: true`;
the palette's own `bark`, `canopyMid` and `pine`; and the scales from
`manifest.ts`, so the lineup shows the models at the sizes `Foliage` will
instance them at relative to each other. It models no lighting, shadows, wind or
season tint, and it is not a substitute for seeing the game run.

It doubles as a check a person can actually perform: the numeric invariants in
§9.5 assert that each canopy sits above its trunk, but a render shows whether
the tree looks like a tree. Output is in `docs/preview/`.

**The renders immediately showed two things the numbers did not, and both have
since been acted on:**

- **`tree_palmShort` at ×5.7 was disproportionately chunky** — a short, stubby
  palm scaled a long way up to reach the 6 m the procedural palm occupied, so
  its trunk read far thicker than every other tree's. **Replaced with
  `tree_palmDetailedTall`**, which is 1.42 units tall against 1.06 and so needs
  ×4.2 instead. It costs 300 triangles against 156 and is worth it: it reads as
  a palm rather than a club.
- **The bushes were narrower than what they replace.** Height matched (the
  procedural bush is ~0.84 m, `plant_bush` at ×3.5 was ~0.85 m) but the
  procedural version is a wide icosahedron blob and the plain Kenney one is a
  few sparse leaves, so ground cover would have read thin. **Replaced with
  `plant_bushDetailed`** at ×2.4 — same height, considerably fuller.

Swapping the palm forced a real correction to the build script, described in
§9.5d. Neither of these was a defect the numeric checks could have caught; both
were obvious in a picture.

### 9.5d Two build-script corrections the swap exposed

- **Node transforms were only partly composed.** `buildNatureKit.mjs` read each
  node's own `translation` and `scale` and ignored `rotation` and any parent
  chain. Every model in the first commit is a single flat node, so this was
  invisible — but `tree_palmDetailedTall` parents two `leafs` meshes under the
  trunk, one of them rotated 45° about Y and scaled 1.35 on Y alone. Under the
  old code its two frond sets would have landed on top of each other, unrotated:
  a palm with half its crown missing. The script now walks the scene graph and
  composes the full T·R·S chain, and transforms normals by the **inverse
  transpose** of each node matrix rather than rotating and renormalising them —
  which matters precisely because that frond scale is non-uniform. This is
  groundwork as much as a fix: the buildings and furniture kits are hierarchical
  throughout, so a flat reader would not have survived contact with them.
- **Two zero-area triangles shipped in `tree_oak`.** Caught by the new
  `assets:verify-kit` (below) the first time it ran. Confirmed to originate in
  Kenney's own `tree_oak.glb` rather than in this pipeline, and now pruned at
  build time along with the unplaced models — they draw nothing but drag
  vertices into the compacted buffer.

### 9.5e `npm run assets:verify-kit`

The structural and geometric checks reported in §9.5 were, in the first commit,
run from a throwaway script. They are now `tools/verifyKitGlb.mjs`, so they are
reproducible rather than a claim in a document.

It complements rather than duplicates `assets:verify`: that one exercises the
**import path** (`gltfImport` against a synthetic glTF) and needs `three`; this
one validates the **artefact the build script produces** and needs nothing but
node, so it runs even in an environment where the dependencies cannot be
installed — which is exactly the environment this work happened in.

The checks are chosen for failures that are silent rather than loud: a wrong
accessor `min`/`max` still loads and then culls wrongly at distance; an index
past the end of a vertex buffer may render until a driver objects; a canopy
grounded independently of its trunk passes every structural test and simply
looks wrong. Normals are checked for unit length specifically to catch a botched
inverse transpose, and triangles for zero area — the check that found the
`tree_oak` pair. All pass on the current kit.

### 9.5f Buildings, homes and paths — `buildings.glb` (asset #2)

Downloaded from `kenney.nl/assets/fantasy-town-kit` (Fantasy Town Kit 2.0, CC0
read in-archive, quoted in §9.2). 23 of its 167 models, **138,124 bytes**, 3,806
verts, 2,334 tris, built by the same `tools/buildKit.mjs`:

| Group | Models |
| --- | --- |
| Paths | `road`, `road-bend`, `road-corner`, `road-edge`, `road-curb` |
| Walls | `wall`, `wall-corner`, `wall-doorway-square`, `wall-window-shutters`, `wall-wood`, `wall-wood-corner` |
| Roofs | `roof-gable`, `roof-gable-end`, `roof-gable-top`, `roof-corner`, `roof-flat`, `chimney` |
| Yards | `fence`, `fence-gate`, `hedge`, `hedge-gate`, `stairs-stone`, `lantern` |

This kit differs from the Nature Kit in two ways that each forced real work.

**It is textured, and the texture is a gradient ramp.** All 167 models share one
512×512 `colormap.png`. The first assumption — that it is a flat-swatch palette,
so a model could be split by atlas colour the way the trees split by material —
is wrong: sampling shows **40–60 distinct shades per model**, because Kenney
authors these as ramps. There are no discrete roles to split on. So the atlas is
sampled per vertex into `COLOR_0` and dropped: the look is preserved, no texture
ships at all (no KTX2 step, no second request), and the manifest sets
`keepVertexColors: true` — which is exactly what that option was written for.

**Its pieces are modular, so the authored origin is load-bearing.** This one was
nearly a silent disaster. `groundAndCentre` is right for a tree and wrong for a
wall: `wall` spans x 0.40..0.50 in the source, sitting on its tile's *edge* so
four of them enclose a room. Centring it moved it to x −0.05..0.05, the tile's
middle — four walls would have collapsed into a post instead of a room, and
every structural check would still have passed. Modular kits now set
`preserveOrigin`, and `buildKit.mjs` **asserts** the built bounds match the
source, transforming the source's bounding box through the same node matrices so
the comparison is like-for-like. All 23 pieces verified unmoved.

Two more things the kit exposed:

- **UNSIGNED_BYTE indices.** The town kit indexes its small meshes with
  `componentType` 5121. The Nature Kit reader handled only USHORT/UINT and
  walked off the end of the buffer. The accessor reader now covers every integer
  width and honours `byteStride`.
- **14 more degenerate triangles**, in `road-bend`, `road-corner`,
  `wall-window-shutters` and `roof-gable-end`, pruned like `tree_oak`'s.

**What this does *not* do is swap `Buildings.ts` over**, and there is a design
question in the way that is worth stating before anyone tries. The game builds
its 8 named buildings from parameterised procedural parts, and
`applyHouseStyle` recolours the player's cottage by **matching material hex
colours** — roof, body, trim, door. Baked vertex colours have no material colour
to match, so that mechanism does not survive a naive swap. Options are to
re-tint per-instance through `InstancedMesh.setColorAt`, to split pieces by
colour at build time after all (harder here than for the trees, given the
ramps), or to keep the cottage procedural and use the kit for the other
buildings. That is a decision about a gameplay feature, not an asset question.

**One cost this introduces, stated rather than buried.** `AssetManager.loadAll`
fetches every kit that `referencedKits()` names, and adding these entries puts
`buildings` on that list. So the game now fetches and retains 138 KB of building
geometry that **nothing renders yet** — `Buildings.ts` is untouched. That is
~12% of the current ~1.16 MB first load, for no visible benefit until the
buildings are wired.

It is left in rather than worked around, for two reasons: the entries are the
verified record of what is in the file and where it came from, and `Buildings.ts`
is the next category in the queue, so the fetch stops being wasted shortly. But
§5 step 6 does call for lazy-loading kits behind their systems, and this is
exactly such a case — whoever wires `Buildings.ts` should add that (a `lazy`
flag on `KitDef`, skipped by `loadAll` and loaded on demand) and measure it,
from an environment that can actually run `vite build`. Flagging it here so the
next person finds it deliberately rather than discovering an unexplained 138 KB.

### 9.5h Props, tools — and a way round the fish blocker (`props.glb`)

Kenney Survival Kit 2.0, CC0 read in-archive and quoted in §9.2. 18 of its 80
models, **153,948 bytes**, 4,438 verts, 2,525 tris:

| Group | Models |
| --- | --- |
| Scatter rocks | `rock-a`, `rock-b`, `rock-c` |
| Dressing | `barrel`, `box`, `chest`, `bucket`, `campfire-pit`, `signpost`, `tent`, `tree-log` |
| Resource drops | `resource-wood`, `resource-stone` |
| Tools | `tool-axe`, `tool-pickaxe`, `tool-shovel`, `tool-hoe` |
| Fish | `fish` |

Standalone props rather than grid modules, so unlike the town kit these take the
default grounding and centring — which is why `prop()` exists alongside
`BUILDING_PIECE` in the manifest rather than one preset serving both.

**The fish blocker has a way round it, and it was sitting in an already-approved
pack.** §7 step 4's third slice item — one fish through `FishSchools` to
`CatchCard` — has been blocked throughout on Quaternius' download host (§9.4).
The Survival Kit ships `fish.glb`, and §3 #4 already approves that pack: this is
not a new source, it is a different model from a pack whose licence is verified
and whose art is already shipping. What it is *not* is a like-for-like
substitute — Quaternius' pack is seven rigged, animated species, and this is one
static mesh. It suits `CatchCard` exactly (a caught fish held up is a still
pose) and would need procedural motion for `FishSchools`. Carried in `props.glb`
as `fish.generic` so the option is real rather than theoretical; whether to take
it or keep waiting for Quaternius is the owner's call, since it trades seven
animated species for one static one.

`fish-large` is deliberately excluded: it is the same mesh at exactly 1.5x, so
shipping it would have duplicated 593 vertices to express what
`normalize.scale` already expresses for nothing.

**Two things this kit exposed in the pipeline:**

- **Indexed-palette PNG.** Its colormap is colour type 3 (palette + PLTE) where
  the Fantasy Town Kit's is truecolour. The decoder handled 2 and 6 only and
  refused the file outright — loudly, which is what a strict decoder is for. It
  now resolves palette entries too.
- **Ten more degenerate triangles**, in `bucket` and `tool-shovel`.

The tools are worth a note for later: the kit also ships `-upgraded` variants of
all four, which map onto the tool levels the game already tracks in its save
schema. They are not carried yet because nothing reads them.

### 9.5i Furniture — and a colour-space bug in the two kits before it

Kenney Furniture Kit 2.0, CC0 read in-archive and quoted in §9.2. 20 of its 140
models, **191,740 bytes**, 5,498 verts, 3,592 tris — one per kind
`housing/FurnitureModels.ts` builds (sofa, table, lamp, rug, music, plant,
shelf, bed, chair), plus a second option where a room wants more than one.

**A third colour mode.** This kit has flat `baseColorFactor` materials like the
Nature Kit, but splitting by material is wrong here: a tree wants its trunk and
canopy tinted independently, whereas a cabinet is one object the player places
and rotates as a unit — and it is wood + woodDark + metal, which under
split-by-material would become three nodes to reassemble. So `bake-materials`
writes each primitive's own colour to its vertices, giving one node per model.
The pipeline now has three strategies, one per kind of source it has met:
`split-by-material`, `bake-atlas`, `bake-materials`.

**The bug this turned up, in kits already shipped.** Deciding where the flat
colours go meant checking what `COLOR_0` actually holds, and the glTF spec is
explicit: **`COLOR_0` is linear**, while a `baseColorTexture` is **sRGB**. The
atlas bake for `buildings.glb` and `props.glb` copied raw sRGB bytes straight
into `COLOR_0`, skipping the sRGB→linear decode the renderer would have done
when sampling the texture. Every surface in both kits would have rendered washed
out and too bright.

Both are rebuilt with the decode applied. `baseColorFactor` needs no conversion
— it is already linear — so the furniture kit was correct from the start, and
only the two atlas kits changed. The previews are unchanged, because
`renderKit` now encodes back to sRGB for display: that round trip landing where
it started is the check that both directions agree.

Stated plainly: this is a **spec-correct change that has not been confirmed
visually in three**. It cannot be, from an environment with no npm. If the
colours look wrong when someone next runs the game, this is the change to look
at first.

Colours are stored as normalised `UNSIGNED_BYTE`, so linear values give up some
precision in the darks compared with sRGB encoding. For flat, mid-tone palette
art that is a fair trade against tripling the attribute to float32; if banding
ever shows in dark surfaces, that is the knob.

### 9.5j Items — and the half of the item table that has no source

Kenney Food Kit 2.0, CC0 read in-archive and quoted in §9.2. 16 of its 200
models, **199040 bytes**, 5,876 verts, 3,580 tris: carrot, cabbage, corn, tomato,
pumpkin, apple, strawberry, bread, cheese, egg, sandwich, pie, cake, soup,
dinner plate and sushi. Same baked-atlas path as the town and survival kits;
`items` is a new `KitId`, since `KITS` had no entry for the Food Kit.

**What it does not cover, which matters more than what it does.**
`items/ItemModels.ts` draws twenty kinds, and the Food Kit answers five of
them — root, leaf, gourd, berry, dish. The other fifteen are:

| Kind | Status |
| --- | --- |
| `fish`, `flatfish`, `ray` | Quaternius blocked (§9.4); one static Kenney fish carried in `props.glb` as a partial answer (§9.5h) |
| `butterfly`, `beetle`, `dragonfly` | **no source in §3 at all** |
| `shell`, `ammonite`, `star`, `jelly`, `bone` | **no source in §3 at all** |
| `log`, `stone`, `fiber`, `seed` | `props.glb` has `tree-log`, `resource-stone` and `resource-wood`; `fiber` and `seed` have none |

So the museum's insect and sea-life wings have no art path, and nothing in the
approved shortlist supplies one. That is a gap in §3 rather than a gap in the
work: filling it needs a new source, which is a plan decision and so the
owner's, not something to quietly resolve by reaching outside the list. The
procedural `ItemModels` geometry keeps drawing them in the meantime, which is
exactly the fallback the manifest was built around.

### 9.5k UI font (#19) — the one non-CC0 thing that ships

Nunito, **SIL OFL 1.1**, self-hosted. This is the single deliberate exception in
§8 decision 4, and it was blocked for a reason worth restating: earlier in this
section `fonts.gstatic.com` was reachable while `fonts.google.com` was not, so
the bytes could be fetched but the licence could not be read — and §7 step 1
forbids committing anything whose licence has not been read. Both hosts are open
now, so the licence came first: `OFL.txt` verbatim from Google Fonts' own
`download/list` manifest, saved to `licenses/fonts-OFL.txt`. Shipping it is what
OFL 1.1 asks for. Nunito declares **no Reserved Font Name**, so clause 3 — the
part that would restrict renaming — does not apply.

Not a new choice: `src/ui/styles.css` already declared
`--font: "Nunito", "Quicksand", …` and has been falling through to `system-ui`
all along. This just supplies the font it already asked for.

**The variable font, not static weights.** The UI uses 400, 700, 800 and 900.
Four static files would be ~132 KB each (528 KB); the variable file is 275,644
bytes and covers 200–1000 continuously. `fonts.googleapis.com` is *not*
allowlisted, so the usual `css2` route to a subset WOFF2 is closed — but
`fonts.google.com/download/list` returns real `fonts.gstatic.com` URLs, which is
how the file was fetched from Google's own distribution rather than a mirror.

**It is a TTF, not a WOFF2, and that is a compromise.** §3 #19 asks for a ~30 KB
WOFF2 subset. Converting needs `fonttools` (pip is blocked) or a WOFF2 encoder
(npm is blocked), and hand-rolling one was not worth the risk of a silently
malformed font. Measured instead: 275,644 raw, 126,197 gzip, **107,617 brotli**
— so `docker/nginx.conf` now gzips `font/ttf` and declares its MIME type. A
subset WOFF2 would still be roughly a third of that and remains worth doing from
an environment with the tooling.

**It lives in `src/assets/fonts/`, not `public/assets/fonts/` where §4 puts it**,
and deliberately. A model GLB is fetched by path at runtime, so `public/` is
right for it. A font referenced from CSS is resolved by Vite at *build* time, and
`base: './'` is exactly the configuration Vite warns about for root-absolute
`public/` references. Importing from `src/` means a wrong path fails the build
instead of 404ing in front of a player, and the file is content-hashed, so it
needs no cache-busting rule of its own. Recorded here as a deviation from §4
rather than a silent one.

### 9.5g `buildNatureKit.mjs` is now `buildKit.mjs`

Generalised to build any kit from a config table, because the second kit needed
a different colour strategy, a different origin policy and a wider accessor
reader — all of which would otherwise have been copy-pasted.

The refactor was guarded the only way that is meaningful without a test suite:
`nature.glb` was rebuilt after every step and checked **byte-identical** by
SHA-256 against the committed file. It is, at every stage and at the end.

### 9.6 Asset payload measured

| Group | Bytes |
| --- | --- |
| `nature.glb` | 58,984 |
| `buildings.glb` | 138,124 |
| `props.glb` | 153,948 |
| `furniture.glb` | 191,740 |
| `items.glb` | 199040 |
| 8 OGG sound effects | 60,075 |
| **Total** | **801911 (783.1 KB)** |

Against the ≤ 8 MB first-load budget in §5 that is **9.5%**. Neither group is in
the JS bundle: the OGGs are fetched after the audio context unlocks, and
`nature.glb` is not fetched at all yet (see below).

### 9.7 Deliberately not done

> **The first two bullets below have since been done** — see "Model half of the
> slice wired and verified in a browser" further down. They are kept as the
> record of why they waited, and because the reasoning still governs the
> categories that have not been wired yet.

- ~~**`Foliage.ts` is not yet driven by `nature.glb`.**~~ Done. The swap was
  held back here because with no `three`, no `@types/three` and no `vite` it
  could not be typechecked, built or run even once, and pushing an unexercised
  rendering change is worse than pushing the asset and the data. It landed from
  a session that *did* have the toolchain, which is the right way round — and
  which immediately turned up a bug (`AssetManager` discarding every model's
  `normalize`) that no amount of static checking here would have found.
- ~~**`AssetManager` is still not wired into `Game.ts`.**~~ Done, in the same
  commit, once there was geometry for it to load.
- **§7 step 6 (the wholesale category-by-category swap) was not started**, as
  intended: it is separate commits and separate review. Buildings are now
  downloaded and in `MODELS` but still not wired — see §9.5f.

### Model half of the slice wired and verified in a browser, 2026-09-14

§7 step 4b is done: `nature.glb` now drives `world/Foliage.ts` for all four
tree kinds and for bushes. `AssetManager` is constructed in `main.ts` before
`Game`, behind a small loading caption, and passed down to `Foliage`.

Kept intact per §7.1: geometry is swapped, nothing else. Imported meshes keep
`createStylizedMaterial` — the importer hands back bare geometry, so the pack's
own materials never enter the scene and season tint, wind and wetness keep
working. Every mesh stays an `InstancedMesh`.

Two design points worth recording:

- **The kit swap is all-or-nothing per tree kind.** A kind uses kit art only
  when both its trunk *and* canopy are present, because the procedural blob
  canopy is offset and scaled for the generated cylinders and would float at
  the wrong height above a kit trunk.
- **Kit and procedural canopies shake through one path.** A kit canopy is
  modelled above its own trunk, so it rides the tree's transform with a zero
  offset; grouping both kinds of canopy lets `update` drive them identically
  rather than branching on which art is loaded.

### A bug the checks could not have caught, found by running the game

`AssetManager` called `extractGeometries(gltf.scene)` with **no options**, so
every model's `normalize` in the manifest was silently discarded:

- `scale` was never applied, so trees loaded at the kit's authored ~1.7 units
  instead of the 3.2-4.2 the manifest asks for — roughly a third of the height
  of the procedural trees they replace.
- `groundOrigin` and `centreXZ` fell back to their defaults of `true`, which
  grounds each node *individually*. That put every canopy at the foot of its
  own trunk — the exact failure the manifest's `groundOrigin: false` comment
  warns about, since the build script grounds each tree as a whole.

`assets:verify` passed throughout, because it calls `extractGeometries` with
explicit options against a synthetic fixture; the production path never passed
the manifest's. The fix makes `extractGeometries` accept a per-node resolver
and has `AssetManager` supply each model's own `normalize`. Three checks were
added covering the resolver, so the production path is now exercised — 13
checks, all passing.

**Verified in a real browser** (headless Chromium against `vite preview`), not
only by type-checking: `nature.glb` fetches 200, the scene graph shows
`Trunks_*`/`Canopy_*` carrying kit triangle counts (74/50/36/130 trunk,
40/180/300/64 canopy) rather than the generated ones, bushes at 104 triangles
are `plant_bushDetailed`, no procedural `Canopy_0..2`/`PineCanopy`/`PalmCanopy`
remain, and there are no page errors.

The one console failure is pre-existing and unrelated: the page hot-links
`fonts.googleapis.com`, which fails on a restricted network. Self-hosting it is
exactly asset #19, still blocked on reading `OFL.txt`.

### Bundle after the model slice (`npm run build`)

| Chunk | Raw | Gzip | vs baseline |
| --- | --- | --- | --- |
| `three` | 566.32 kB | 145.15 kB | +43.95 / +11.94 |
| app | 453.46 kB | 138.38 kB | +74.12 / +21.24 |
| CSS | 25.80 kB | 6.36 kB | — |
| **Total** | **1045.58 kB** | **289.89 kB** | **+118.07 / +33.18** |

The growth is `GLTFLoader` plus the meshopt decoder, which the baseline note
predicted would arrive with the first kit. On top of that sat 116.3 KB of assets
at the time of this measurement, so first load was ~1.16 MB against the §5
budget of <= 8 MB.

`buildings.glb` (138 KB) landed after this build was measured, taking assets to
251.2 KB and first load to ~1.30 MB — still 16% of budget. **That figure is
arithmetic on top of a measured build, not a measured build of its own:** the
session that added the buildings kit has no npm, so it could not re-run
`vite build`. The JS side is unchanged by it either way, since a kit is a
runtime fetch rather than bundle content.

### Coverage as it actually stands, 2026-09-14

Scope confirmed by the owner: houses, buildings, paths, items and interiors are
in scope alongside foliage — i.e. §7 step 6 proper, not just the step 4 slice.
Recording the honest state so the gap is tracked rather than assumed.

| Category | Kit | Downloaded | Wired |
| --- | --- | --- | --- |
| Foliage (trees, bushes) | Kenney Nature Kit | ✅ | ✅ `world/Foliage.ts`, 10 models |
| SFX + UI audio | Kenney RPG / Interface / Impact | ✅ | ✅ 8 sounds via `sounds.ts` |
| Buildings, houses | Kenney Fantasy Town Kit | ✅ | ❌ `BuildingKit.ts`, `Buildings.ts` — 23 models in `MODELS`, see §9.5f |
| Interiors | Kenney Fantasy Town / Furniture | ❌ | ❌ `InteriorKit.ts`, `Interiors.ts` |
| Furniture | Kenney Furniture Kit | ✅ | ❌ `housing/FurnitureModels.ts` — 20 models, see §9.5i |
| Props | Kenney Survival Kit | ✅ | ❌ `world/Props.ts` — 18 models, see §9.5h |
| Items | Kenney Food Kit | ✅ | ❌ `items/ItemModels.ts` — 16 models, see §9.5j |
| Paths / paving | Kenney Fantasy Town Kit (`road-*`) | ✅ | ❌ terrain path surfaces — 5 road pieces, see §9.5f |
| Fish | Quaternius ❌ blocked — Kenney Survival Kit ✅ instead | ✅ | ❌ `fishing/FishSchools.ts` — see §9.5h |
| Animals | Quaternius | ❌ blocked | ❌ |
| Characters | KayKit | ❌ | ❌ `player/CharacterRig.ts` |

`KITS` in `src/assets/manifest.ts` declares furniture, props, fish, animals and
characters with no file on disk and no `MODELS` entries; `nature.glb` and
`buildings.glb` exist and are populated. A declared kit with no file is not an error — the
loader treats a missing kit as "keep the procedural path" — so the game runs
correctly today; those categories simply have not been replaced yet.

**Paths: answered.** This was flagged as an open question — nothing in §3 was
chosen for paving, and whether Fantasy Town supplies usable pieces had to be
checked against the real kit rather than assumed. It does: the kit ships nine
`road-*` pieces (straight, bend, corner, inner corner, edge, curb, curb-end and
two slopes). Five are in `buildings.glb` — straight, bend, corner, edge and
curb — which covers the shapes `heightfield`'s `PATHS` actually needs. No source
outside §3 was required.

**A note on process, after losing work.** The download session was archived by
the parent session while mid-inventory of the Fantasy Town Kit, and everything
it had not pushed went with its container. Downloads happen in an environment
where the asset hosts are reachable but npm is not, so that session cannot run
the toolchain: work must be pushed per category as it completes, and verified
from an environment that has npm. Nothing should sit uncommitted across
categories again.

### Bundle baseline (pre-asset, `npm run build`)

Unchanged and **not re-measured this session** — `vite` is unavailable, so this
remains the last known-good measurement, recorded before any asset landed:

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `three` | 522.37 kB | 133.21 kB |
| app | 379.34 kB | 117.14 kB |
| CSS | 25.80 kB | 6.36 kB |
| **Total** | **927.51 kB** | **256.71 kB** |

The app chunk should be expected to grow slightly once the `preloadSources`
addition is built, and the JS bundle is otherwise untouched by this commit; the
≤ 8 MB budget in §5 is for assets on top of this.

### 9.8 What the next session needs

1. **`registry.npmjs.org` on the allowlist** (or a pre-populated `node_modules`).
   Without it `typecheck`, `build` and `assets:verify` cannot run, the §7 step 5
   numbers cannot be produced, and no code touching `three` can be verified.
2. **`drive.google.com` on the allowlist**, for every Quaternius pack — the fish
   (#10) and therefore the third slice item depend on it.
3. **A decision on Tallbeard (#15):** either permission for itch.io's
   "name your own price" download flow, or a different CC0 music source, which
   would be a change to §3 and so is the owner's call.

### 9.9 Open for the self-hosted multiplayer build

Neither of these is asset work, and neither is done. Recorded here because both
were found while checking what the multiplayer target changes, and both get more
expensive the later they are picked up.

- **Assets in `public/` carry no cache-busting — settled, in `docker/nginx.conf`.**
  Vite content-hashes the bundle chunks but copies `public/` verbatim, so
  `nature.glb` and the eight OGGs keep the same URL across deploys. With Docker
  as the deployment target the answer is headers rather than filenames: hashed
  bundle output is served `immutable` for a year, and
  `/assets/{models,audio,textures,fonts}/` is served `no-cache`, meaning
  revalidate — so a redeployed image reaches a browser that already has the old
  art, at the cost of a 304 with no body.
  Both kinds live under `/assets/` because Vite's default `assetsDir` is
  `assets` and `public/assets/` copies alongside it; they are told apart by
  subdirectory (nginx evaluates regex locations before prefix ones) rather than
  by changing `build.assetsDir`, which would have meant editing build config
  that cannot be built or tested in this environment. **Not built or run here**
  — there is no Docker daemon, and npm is blocked, so the image has never been
  assembled.
- **`Math.random()` in gameplay will diverge across clients.** The world itself
  is already safe: `world/heightfield.ts` is pure and deterministic and imports
  no `three`, so an authoritative headless server can share it directly, and
  `Foliage` scatters from a fixed seed (`new Rng(90210)`), so trees land
  identically everywhere with nothing synced — and the asset swap cannot break
  that, since placement depends on the Rng and the heightfield, never on
  geometry. What does diverge: `fishing/FishingSystem.ts` (bite timing, struggle,
  and the loot roll at line 470 — what you catch has to become server
  authoritative) and `npc/Villager.ts` (wander timers and direction, so NPCs walk
  different paths per client). `Foliage.ts:448` (shake phase) and
  `player/CharacterRig.ts` (blink timers) are cosmetic and can stay as they are.
