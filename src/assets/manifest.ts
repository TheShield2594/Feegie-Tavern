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
export type KitId = 'nature' | 'buildings' | 'furniture' | 'props' | 'fish' | 'animals' | 'characters';

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
 * Model table.
 *
 * Ids are the game's own vocabulary (`TreeKind` in `world/Foliage.ts`), not the
 * pack's filenames, so swapping Kenney for another CC0 kit is an edit to `node`
 * and nothing else.
 *
 * `node` names are read out of the built `nature.glb`, never invented. Each
 * Kenney tree ships as one mesh with two primitives sharing a vertex buffer —
 * bark and leaves — and `tools/buildNatureKit.mjs` splits them into separate
 * single-primitive nodes so `Foliage` can bind its existing bark and canopy
 * materials to them independently.
 *
 * **Why every entry sets `groundOrigin: false` and `centreXZ: false`:** the
 * build script already grounded and centred each model *as a whole*, moving
 * trunk and canopy together. Letting `normalizeGeometry` redo it per node would
 * drop each canopy to y = 0 independently and take the trees apart.
 *
 * `scale` brings the kit (authored ~1–1.7 units tall) up to the dimensions of
 * the procedural geometry it replaces, so the existing placement, keep-out and
 * per-instance scale ranges in `Foliage` keep working unchanged.
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
];

export const MODELS_BY_ID = new Map<string, ModelDef>(MODELS.map((m) => [m.id, m]));

/** Kits that have at least one model referencing them. */
export function referencedKits(): KitId[] {
  return [...new Set(MODELS.map((m) => m.kit))];
}
