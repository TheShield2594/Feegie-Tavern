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
 * Empty until the packs are downloaded and their real mesh names are read out
 * of the GLB — inventing node names before seeing the file would only produce
 * entries that silently miss. `npm run assets:inspect <file.glb>` prints the
 * node names to paste here.
 */
export const MODELS: ModelDef[] = [];

export const MODELS_BY_ID = new Map<string, ModelDef>(MODELS.map((m) => [m.id, m]));

/** Kits that have at least one model referencing them. */
export function referencedKits(): KitId[] {
  return [...new Set(MODELS.map((m) => m.kit))];
}
