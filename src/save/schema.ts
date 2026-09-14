import type { CharacterLook } from '@/data/clothing';
import type { InventoryItem } from '@/items/types';
import type { WeatherKind } from '@/time/WeatherSystem';

/**
 * Current on-disk schema version.
 *
 * Bump this whenever the shape below changes and add a matching entry to
 * MIGRATIONS in ./migrations.ts. Never edit an old migration — write a new one.
 */
export const SAVE_VERSION = 7;

export const SAVE_KEY_PREFIX = 'cozyCove.save.v7.slot';
/** Older keys, read once each so existing players keep their island. */
export const LEGACY_V6_KEY_PREFIX = 'cozyCove.save.v6.slot';
export const LEGACY_V5_KEY_PREFIX = 'cozyCove.save.v5.slot';
export const LEGACY_V4_KEY_PREFIX = 'cozyCoveSaveV4_slot';
export const LEGACY_V2_KEY = 'cozyCoveSaveV2';

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

export interface PlacedFurnitureData {
  uid: string;
  defId: string;
  /** Local position within the interior, in metres. */
  x: number;
  z: number;
  /** Height off the floor — non-zero for tabletop and wall placements. */
  y: number;
  /** Yaw in radians, snapped to 90° increments by the placement UI. */
  rotation: number;
  room: string;
}

export interface PlacedDecorData {
  uid: string;
  defId: string;
  /** World position on the island, in metres. */
  x: number;
  z: number;
  /** Yaw in radians, snapped to eighth-turns by the build cursor. */
  rotation: number;
  /** Chosen colourway, for the pieces that offer any. */
  tint?: string;
}

export interface CropPlotData {
  id: string;
  x: number;
  z: number;
  cropId: string;
  /** In-game minutes of growth accumulated. */
  growth: number;
  watered: boolean;
  wateredOnDay: number;
  tilled: boolean;
}

export interface GatherableStateData {
  id: string;
  /** In-game day the node was harvested; it regrows after a cooldown. */
  harvestedOnDay: number;
}

export interface RelationshipData {
  friendship: number;
  lastTalkedDay: number;
  giftsGiven: number;
  request?: { itemDefId: string; reward: number; done: boolean; day: number };
}

export interface SettingsData {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  quality: 'low' | 'medium' | 'high';
  cameraShake: boolean;
  invertCameraX: boolean;
}

export interface SaveDataV7 {
  version: 7;
  slot: number;
  savedAt: number;
  playtimeSeconds: number;

  clock: {
    day: number;
    /** Minutes since midnight, 0–1439. */
    minutes: number;
  };

  weather: {
    kind: WeatherKind;
    /** In-game minutes remaining on the current pattern. */
    remaining: number;
  };

  player: {
    position: Vec3Data;
    facing: number;
    coins: number;
    look: CharacterLook;
    inventory: InventoryItem[];
    bagLevel: number;
    materials: { wood: number; stone: number; fiber: number };
    seeds: number;
    toolLevels: { rod: number; net: number; shovel: number; axe: number; wateringCan: number };
    stats: {
      totalCaught: number;
      totalSold: number;
      harvested: number;
      flowersPlanted: number;
      cooked: number;
      /** Largest measured size per species, drives "new record" catch cards. */
      records: Record<string, number>;
    };
  };

  museum: {
    /** Item def ids the player has donated. */
    donated: string[];
  };

  home: {
    level: number;
    styleId: string;
    /** Exterior colourways the player has bought. Free styles are always in. */
    ownedStyles: string[];
    ownedFurniture: string[];
    placed: PlacedFurnitureData[];
  };

  farm: {
    plots: CropPlotData[];
  };

  world: {
    /**
     * Decorative flowers the player planted around town.
     *
     * Written as a projection of the flower beds in `decor`, which is the
     * authoritative list. Kept because the prototype's saves carry their
     * gardens in this shape and this is where they land on the way in.
     */
    gardens: { x: number; z: number; color: string }[];
    /** Everything the player has placed outdoors — flowers, fences, lamps, paths. */
    decor: PlacedDecorData[];
    /** Sea creatures already taken off the shelf, and the day they were taken. */
    reef: { id: number; takenOnDay: number }[];
    gatherables: GatherableStateData[];
    townWorks: { bridge: boolean; stairs: boolean; lighthouse: boolean };
    /** Whether the Secret Orchard's gate has been unlocked. */
    orchardOpen: boolean;
  };

  quests: {
    activeId: string;
    progress: number;
    /** Day the current daily quest was issued. */
    issuedDay: number;
    completedIds: string[];
  };

  relationships: Record<string, RelationshipData>;

  story: {
    stage: number;
  };

  settings: SettingsData;
}

/** Any historical shape. Migrations narrow these into SaveDataV7. */
export type AnySaveData = SaveDataV7 | Record<string, unknown>;

export const DEFAULT_SETTINGS: SettingsData = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.85,
  ambienceVolume: 0.7,
  quality: 'high',
  cameraShake: true,
  invertCameraX: false,
};
