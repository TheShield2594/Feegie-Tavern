/**
 * Asset manifest.
 *
 * Deliberately mirrors `data/` and `audio/sounds.ts`: what the game loads is a
 * data table, not code. Swapping one CC0 pack for another — or renaming a mesh
 * inside a kit — is an edit here, never an edit to a world system.
 *
 * Nothing in this file is required for the game to run. Every model the
 * manifest names is optional: when a kit file is absent the world systems fall
 * back to the procedural geometry they have always used. That is what lets the
 * production art land one category at a time instead of in one large swap.
 */

/** A single downloaded pack, optimised into one GLB. */
export type KitId =
  | 'nature' | 'buildings' | 'furniture' | 'props' | 'items' | 'resources'
  | 'fish' | 'animals' | 'characters';

export interface KitDef {
  id: KitId;
  /** Path under `public/`, resolved against Vite's BASE_URL at load time. */
  file: string;
  /** Source pack, for ASSET_CREDITS.md and for tracing a mesh back to its licence. */
  source: string;
  licence: 'CC0-1.0';
}

export const KITS: KitDef[] = [
  { id: 'nature',     file: 'assets/models/nature/nature.glb',         source: 'Kenney — Nature Kit',                licence: 'CC0-1.0' },
  { id: 'buildings',  file: 'assets/models/buildings/buildings.glb',   source: 'Kenney — Fantasy Town Kit',          licence: 'CC0-1.0' },
  { id: 'furniture',  file: 'assets/models/furniture/furniture.glb',   source: 'Kenney — Furniture Kit',             licence: 'CC0-1.0' },
  { id: 'props',      file: 'assets/models/props/props.glb',           source: 'Kenney — Survival Kit',              licence: 'CC0-1.0' },
  { id: 'items',      file: 'assets/models/items/items.glb',           source: 'Kenney — Food Kit',                  licence: 'CC0-1.0' },
  { id: 'resources',  file: 'assets/models/resources/resources.glb',   source: 'Kay Lousberg (KayKit) — Resource Bits', licence: 'CC0-1.0' },
  { id: 'fish',       file: 'assets/models/fish/fish.glb',             source: 'Quaternius — LowPoly Animated Fish', licence: 'CC0-1.0' },
  { id: 'animals',    file: 'assets/models/animals/animals.glb',       source: 'Quaternius — Animated Animals',      licence: 'CC0-1.0' },
  { id: 'characters', file: 'assets/models/characters/characters.glb', source: 'KayKit — Characters',                licence: 'CC0-1.0' },
];

export const KITS_BY_ID = new Map<KitId, KitDef>(KITS.map((k) => [k.id, k]));

/**
 * How an imported mesh is conditioned before a world system instances it.
 * Defaults match what the kits in `KITS` actually ship: Y-up, metres, origin
 * already at the base.
 */
export interface NormalizeOptions {
  /**
   * Drop the mesh so its lowest vertex sits at y = 0. The wind shader derives
   * stiffness from local Y (`transformed.y`), and terrain placement assumes a
   * base at the origin, so this matters for anything planted in the ground.
   * Default true.
   */
  groundOrigin?: boolean;
  /** Centre the mesh on X/Z. Default true. */
  centreXZ?: boolean;
  /** Uniform scale applied after centring, for kits authored at another size. */
  scale?: number;
  /**
   * Keep the GLB's vertex colours and render with `vertexColors: true` instead
   * of a flat palette colour. Kits that bake several colours into one mesh
   * need this; kits that split trunk and canopy into separate meshes do not.
   */
  keepVertexColors?: boolean;
}

export interface ModelDef {
  /** Logical id the game asks for; stable even if the pack changes. */
  id: string;
  kit: KitId;
  /** Node name inside the GLB. Filled in from the real file at import time. */
  node: string;
  normalize?: NormalizeOptions;
}

/**
 * A standalone prop: keep the baked vertex colours, take the defaults for
 * grounding and centring (unlike a building piece, nothing snaps to it), and
 * scale the kit up to the size of the geometry it replaces.
 */
const prop = (scale: number): NormalizeOptions => ({ keepVertexColors: true, scale });

/**
 * Shared settings for a modular building piece: keep the authored origin, keep
 * the baked vertex colours, keep the grid-cell size.
 */
const BUILDING_PIECE: NormalizeOptions = {
  groundOrigin: false,
  centreXZ: false,
  keepVertexColors: true,
};

/**
 * Model table.
 *
 * Ids are the game's own vocabulary (`TreeKind` in `world/Foliage.ts`), not the
 * pack's filenames, so swapping Kenney for another CC0 kit is an edit to `node`
 * and nothing else.
 *
 * `node` names are read out of the built `nature.glb`, never invented. Each
 * Kenney tree ships as one mesh with two primitives sharing a vertex buffer —
 * bark and leaves — and `tools/buildKit.mjs` splits them into separate
 * single-primitive nodes so `Foliage` can bind its existing bark and canopy
 * materials to them independently.
 *
 * **Why every entry sets `groundOrigin: false` and `centreXZ: false`:** the
 * build script already grounded and centred each model *as a whole*, moving
 * trunk and canopy together. Letting `normalizeGeometry` redo it per node would
 * drop each canopy to y = 0 independently and take the trees apart.
 *
 * `scale` brings the nature kit (authored ~1–1.7 units tall) up to the
 * dimensions of the procedural geometry it replaces, so the existing placement,
 * keep-out and per-instance scale ranges in `Foliage` keep working unchanged.
 * The building pieces carry no scale — see the note above them.
 */
export const MODELS: ModelDef[] = [
  { id: 'tree.broadleaf.trunk',  kit: 'nature', node: 'tree_default_trunk',       normalize: { groundOrigin: false, centreXZ: false, scale: 3.2 } },
  { id: 'tree.broadleaf.canopy', kit: 'nature', node: 'tree_default_canopy',      normalize: { groundOrigin: false, centreXZ: false, scale: 3.2 } },
  { id: 'tree.pine.trunk',       kit: 'nature', node: 'tree_pineDefaultA_trunk',  normalize: { groundOrigin: false, centreXZ: false, scale: 4.1 } },
  { id: 'tree.pine.canopy',      kit: 'nature', node: 'tree_pineDefaultA_canopy', normalize: { groundOrigin: false, centreXZ: false, scale: 4.1 } },
  { id: 'tree.palm.trunk',       kit: 'nature', node: 'tree_palmDetailedTall_trunk',  normalize: { groundOrigin: false, centreXZ: false, scale: 4.2 } },
  { id: 'tree.palm.canopy',      kit: 'nature', node: 'tree_palmDetailedTall_canopy', normalize: { groundOrigin: false, centreXZ: false, scale: 4.2 } },
  { id: 'tree.fruit.trunk',      kit: 'nature', node: 'tree_oak_trunk',           normalize: { groundOrigin: false, centreXZ: false, scale: 3.9 } },
  { id: 'tree.fruit.canopy',     kit: 'nature', node: 'tree_oak_canopy',          normalize: { groundOrigin: false, centreXZ: false, scale: 3.9 } },
  { id: 'bush.small',            kit: 'nature', node: 'plant_bushDetailed',       normalize: { groundOrigin: false, centreXZ: false, scale: 2.4 } },
  { id: 'bush.large',            kit: 'nature', node: 'plant_bushLarge',          normalize: { groundOrigin: false, centreXZ: false, scale: 3.5 } },

  // --- Fantasy Town Kit -----------------------------------------------------
  //
  // Modular pieces, so two things differ from the nature entries above.
  //
  // `keepVertexColors` — the kit shares one textured atlas across all 167
  // models, and sampling it shows 40-60 shades per model because Kenney authors
  // them as gradient ramps, not flat swatches. There are no material roles to
  // split on, so `tools/buildKit.mjs` bakes the atlas into COLOR_0 per vertex
  // and ships no texture at all. Render these with
  // `createStylizedMaterial({ vertexColors: true })`.
  //
  // No `scale` — a piece is exactly one grid cell, and the *assembly* chooses
  // how many metres a cell is. Scaling pieces individually would break the fit
  // between them.
  //
  // `groundOrigin`/`centreXZ` stay false for a different reason than the trees:
  // here the authored origin is the snap point. `wall` spans x 0.40..0.50 so
  // four walls enclose a tile; centring it would collapse them into a post.
  { id: 'path.straight',   kit: 'buildings', node: 'road',                 normalize: BUILDING_PIECE },
  { id: 'path.bend',       kit: 'buildings', node: 'road-bend',            normalize: BUILDING_PIECE },
  { id: 'path.corner',     kit: 'buildings', node: 'road-corner',          normalize: BUILDING_PIECE },
  { id: 'path.edge',       kit: 'buildings', node: 'road-edge',            normalize: BUILDING_PIECE },
  { id: 'path.curb',       kit: 'buildings', node: 'road-curb',            normalize: BUILDING_PIECE },

  { id: 'wall.plaster',        kit: 'buildings', node: 'wall',                 normalize: BUILDING_PIECE },
  { id: 'wall.plasterCorner',  kit: 'buildings', node: 'wall-corner',          normalize: BUILDING_PIECE },
  { id: 'wall.doorway',        kit: 'buildings', node: 'wall-doorway-square',  normalize: BUILDING_PIECE },
  { id: 'wall.window',         kit: 'buildings', node: 'wall-window-shutters', normalize: BUILDING_PIECE },
  { id: 'wall.timber',         kit: 'buildings', node: 'wall-wood',            normalize: BUILDING_PIECE },
  { id: 'wall.timberCorner',   kit: 'buildings', node: 'wall-wood-corner',     normalize: BUILDING_PIECE },

  { id: 'roof.gable',      kit: 'buildings', node: 'roof-gable',           normalize: BUILDING_PIECE },
  { id: 'roof.gableEnd',   kit: 'buildings', node: 'roof-gable-end',       normalize: BUILDING_PIECE },
  { id: 'roof.gableTop',   kit: 'buildings', node: 'roof-gable-top',       normalize: BUILDING_PIECE },
  { id: 'roof.corner',     kit: 'buildings', node: 'roof-corner',          normalize: BUILDING_PIECE },
  { id: 'roof.flat',       kit: 'buildings', node: 'roof-flat',            normalize: BUILDING_PIECE },
  { id: 'roof.chimney',    kit: 'buildings', node: 'chimney',              normalize: BUILDING_PIECE },

  { id: 'yard.fence',      kit: 'buildings', node: 'fence',                normalize: BUILDING_PIECE },
  { id: 'yard.fenceGate',  kit: 'buildings', node: 'fence-gate',           normalize: BUILDING_PIECE },
  { id: 'yard.hedge',      kit: 'buildings', node: 'hedge',                normalize: BUILDING_PIECE },
  { id: 'yard.hedgeGate',  kit: 'buildings', node: 'hedge-gate',           normalize: BUILDING_PIECE },
  { id: 'yard.steps',      kit: 'buildings', node: 'stairs-stone',         normalize: BUILDING_PIECE },
  { id: 'yard.lamp',       kit: 'buildings', node: 'lantern',              normalize: BUILDING_PIECE },

  // --- Survival Kit ---------------------------------------------------------
  //
  // Standalone props, so these take the default grounding and centring — the
  // opposite of the building pieces above, and the reason `prop()` exists
  // separately from `BUILDING_PIECE`.
  //
  // Scales are matched to the procedural geometry each replaces: the rocks to
  // `Props.buildRocks`, which instances an `IcosahedronGeometry(1)` (so roughly
  // two units across) at 0.8-1.6x, and the tools to the ~1 m handles
  // `player/Tools.ts` builds.
  { id: 'props.rock.a',    kit: 'props', node: 'rock-a',         normalize: prop(3.3) },
  { id: 'props.rock.b',    kit: 'props', node: 'rock-b',         normalize: prop(3.3) },
  { id: 'props.rock.c',    kit: 'props', node: 'rock-c',         normalize: prop(3.3) },

  { id: 'props.barrel',    kit: 'props', node: 'barrel',         normalize: prop(2.8) },
  { id: 'props.crate',     kit: 'props', node: 'box',            normalize: prop(2.8) },
  { id: 'props.chest',     kit: 'props', node: 'chest',          normalize: prop(2.8) },
  { id: 'props.bucket',    kit: 'props', node: 'bucket',         normalize: prop(2.8) },
  { id: 'props.campfire',  kit: 'props', node: 'campfire-pit',   normalize: prop(2.8) },
  { id: 'props.signpost',  kit: 'props', node: 'signpost',       normalize: prop(2.8) },
  { id: 'props.tent',      kit: 'props', node: 'tent',           normalize: prop(2.8) },
  { id: 'props.log',       kit: 'props', node: 'tree-log',       normalize: prop(2.8) },

  // The gatherable wood and stone drops moved to the KayKit Resource Bits kit
  // below (`resource.wood` / `resource.stone`), which reads better as a felled
  // log and a stone pile than the Survival Kit's generic chunks. The
  // `resource-wood` / `resource-stone` nodes still sit in `props.glb`, simply
  // unreferenced now.

  // Named `tools.*` rather than `tool.*` on purpose: `tool.axe` is already a
  // sound id in `audio/sounds.ts`, and the two tables are read side by side.
  { id: 'tools.axe',       kit: 'props', node: 'tool-axe',       normalize: prop(4.0) },
  { id: 'tools.pickaxe',   kit: 'props', node: 'tool-pickaxe',   normalize: prop(4.0) },
  { id: 'tools.shovel',    kit: 'props', node: 'tool-shovel',    normalize: prop(4.0) },
  { id: 'tools.hoe',       kit: 'props', node: 'tool-hoe',       normalize: prop(4.0) },

  // One generic fish mesh, standing in for every species until (or unless)
  // per-species art lands. The kit's `fish-large` is this same mesh at 1.5x, so
  // a bigger catch is a scale rather than a second model. See §9.5h.
  { id: 'fish.generic',    kit: 'props', node: 'fish',           normalize: prop(2.0) },

  // --- Furniture Kit --------------------------------------------------------
  //
  // One entry per kind `housing/FurnitureModels.ts` builds — sofa, table, lamp,
  // rug, music, plant, shelf, bed, chair — plus a second option where a room
  // wants more than one. Colours are baked from the kit's flat materials
  // (wood / woodDark / metal per primitive), so a cabinet stays one node
  // instead of three.
  { id: 'furniture.sofa',      kit: 'furniture', node: 'loungeSofa',         normalize: prop(2.0) },
  { id: 'furniture.sofaLong',  kit: 'furniture', node: 'loungeSofaLong',     normalize: prop(2.0) },
  { id: 'furniture.table',     kit: 'furniture', node: 'table',              normalize: prop(2.0) },
  { id: 'furniture.tableLow',  kit: 'furniture', node: 'tableCoffee',        normalize: prop(2.0) },
  { id: 'furniture.lamp',      kit: 'furniture', node: 'lampRoundTable',     normalize: prop(2.0) },
  { id: 'furniture.lampFloor', kit: 'furniture', node: 'lampRoundFloor',     normalize: prop(2.0) },
  { id: 'furniture.rug',       kit: 'furniture', node: 'rugRectangle',       normalize: prop(2.0) },
  { id: 'furniture.rugRound',  kit: 'furniture', node: 'rugRound',           normalize: prop(2.0) },
  { id: 'furniture.music',     kit: 'furniture', node: 'radio',              normalize: prop(2.0) },
  { id: 'furniture.tv',        kit: 'furniture', node: 'televisionVintage',  normalize: prop(2.0) },
  { id: 'furniture.plant',     kit: 'furniture', node: 'pottedPlant',        normalize: prop(2.0) },
  { id: 'furniture.plantSmall',kit: 'furniture', node: 'plantSmall1',        normalize: prop(2.0) },
  { id: 'furniture.shelf',     kit: 'furniture', node: 'bookcaseOpen',       normalize: prop(2.0) },
  { id: 'furniture.cabinet',   kit: 'furniture', node: 'bookcaseClosedWide', normalize: prop(2.0) },
  { id: 'furniture.bed',       kit: 'furniture', node: 'bedSingle',          normalize: prop(2.0) },
  { id: 'furniture.bedDouble', kit: 'furniture', node: 'bedDouble',          normalize: prop(2.0) },
  { id: 'furniture.chair',     kit: 'furniture', node: 'chair',              normalize: prop(2.0) },
  { id: 'furniture.chairSoft', kit: 'furniture', node: 'chairCushion',       normalize: prop(2.0) },
  { id: 'furniture.stool',     kit: 'furniture', node: 'stoolBar',           normalize: prop(2.0) },
  { id: 'furniture.desk',      kit: 'furniture', node: 'desk',               normalize: prop(2.0) },

  // --- Food Kit -------------------------------------------------------------
  //
  // Mapped onto the kinds `items/ItemModels.ts` draws: root, leaf, gourd, berry
  // and dish. It covers the edible half of that switch and nothing else — the
  // insects, shells, rays and bones there have no source in §3 at all, which
  // §9.5j records rather than quietly leaving to be discovered.
  //
  // `scale` is a starting point, not a fitted value: an item is drawn in hand,
  // as a ground drop and on a museum plinth at three different sizes, so the
  // display scale belongs to whichever system draws it.
  { id: 'item.carrot',     kit: 'items', node: 'carrot',        normalize: prop(2.0) },
  { id: 'item.cabbage',    kit: 'items', node: 'cabbage',       normalize: prop(2.0) },
  { id: 'item.corn',       kit: 'items', node: 'corn',          normalize: prop(2.0) },
  { id: 'item.tomato',     kit: 'items', node: 'tomato',        normalize: prop(2.0) },
  { id: 'item.pumpkin',    kit: 'items', node: 'pumpkin',       normalize: prop(2.0) },
  { id: 'item.apple',      kit: 'items', node: 'apple',         normalize: prop(2.0) },
  { id: 'item.strawberry', kit: 'items', node: 'strawberry',    normalize: prop(2.0) },
  { id: 'item.bread',      kit: 'items', node: 'bread',         normalize: prop(2.0) },
  { id: 'item.cheese',     kit: 'items', node: 'cheese',        normalize: prop(2.0) },
  { id: 'item.egg',        kit: 'items', node: 'egg-cooked',    normalize: prop(2.0) },
  { id: 'item.sandwich',   kit: 'items', node: 'sandwich',      normalize: prop(2.0) },
  { id: 'item.pie',        kit: 'items', node: 'pie',           normalize: prop(2.0) },
  { id: 'item.cake',       kit: 'items', node: 'cake',          normalize: prop(2.0) },
  { id: 'item.soup',       kit: 'items', node: 'bowl-soup',     normalize: prop(2.0) },
  { id: 'item.dinner',     kit: 'items', node: 'plate-dinner',  normalize: prop(2.0) },
  { id: 'item.sushi',      kit: 'items', node: 'sushi-salmon',  normalize: prop(2.0) },

  // --- Resource Bits --------------------------------------------------------
  //
  // The gatherable-material drops `items/ItemModels.ts` shows for `mat.wood` and
  // `mat.stone`. Only these two of the pack's ~75 models are used: the ore,
  // metal, fuel and textile bits have no system to consume them (no mining or
  // crafting), and §5 is "import only the models actually placed".
  //
  // Baked from the pack's shared atlas like the other colour kits, so
  // `keepVertexColors`. Scales normalise each model to roughly one unit so the
  // per-drop scale in `ItemModels` reads the same across both.
  { id: 'resource.wood',   kit: 'resources', node: 'Wood_Log_A',         normalize: prop(0.74) },
  { id: 'resource.stone',  kit: 'resources', node: 'Stone_Chunks_Small', normalize: prop(0.89) },
];

export const MODELS_BY_ID = new Map<string, ModelDef>(MODELS.map((m) => [m.id, m]));

/** Kits that have at least one model referencing them. */
export function referencedKits(): KitId[] {
  return [...new Set(MODELS.map((m) => m.kit))];
}
