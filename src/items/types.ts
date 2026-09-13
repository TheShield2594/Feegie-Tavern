export type ItemCategory =
  | 'fish'
  | 'bug'
  | 'fossil'
  | 'sea'
  | 'crop'
  | 'fruit'
  | 'material'
  | 'meal'
  | 'furniture'
  | 'seed'
  | 'tool'
  | 'clothing';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'crafted';

/** Which museum wing a donatable species belongs to. */
export type MuseumWing = 'aquarium' | 'conservatory' | 'fossilHall' | 'oceanGallery';

export interface ItemDef {
  id: string;
  /** Display name. Kept identical to the prototype where a species existed there. */
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  /** Base sell value in shells. */
  value: number;
  description: string;
  /** Drives procedural icon + world model generation. */
  visual: ItemVisual;
  /** Present only for museum-donatable species. */
  wing?: MuseumWing;
  stackable?: boolean;
  maxStack?: number;
}

/**
 * Items are drawn from parameters rather than bitmaps so the whole catalog can
 * ship before any production art exists. Swapping in real art later means
 * pointing `texture` at a file, not rewriting gameplay.
 */
export interface ItemVisual {
  /** Silhouette family used by both the 3D model and the 2D icon renderer. */
  shape:
    | 'fish'
    | 'flatfish'
    | 'ray'
    | 'butterfly'
    | 'beetle'
    | 'dragonfly'
    | 'shell'
    | 'star'
    | 'jelly'
    | 'bone'
    | 'ammonite'
    | 'leaf'
    | 'root'
    | 'berry'
    | 'gourd'
    | 'log'
    | 'stone'
    | 'fiber'
    | 'dish'
    | 'seed'
    | 'furniture'
    | 'sofa'
    | 'table'
    | 'lamp'
    | 'rug'
    | 'music'
    | 'plant'
    | 'chair'
    | 'shelf'
    | 'bed'
    | 'houseStyle';
  primary: string;
  secondary: string;
  accent?: string;
  /** Relative scale hint, 1 = average for the shape family. */
  scale?: number;
  /** Optional texture path for when production art lands. */
  texture?: string;
}

export interface SpeciesExtras {
  /** Average length in cm; catches roll around this. */
  sizeCm?: number;
  sizeVarianceCm?: number;
  /** Hours of the in-game day the species is active, inclusive-exclusive. */
  activeHours?: [number, number];
  /** Seasons the species appears in. Empty/absent means year-round. */
  seasons?: string[];
  /** Where it can be found. */
  habitat?: 'shallow' | 'deep' | 'river' | 'shore' | 'meadow' | 'forest' | 'beach' | 'reef';
  /** How the fish behaves around a lure, 0 = timid, 1 = aggressive. */
  boldness?: number;
}

export type SpeciesDef = ItemDef & SpeciesExtras;

/** A concrete item the player owns. */
export interface InventoryItem {
  /** Unique per-instance id. */
  uid: string;
  /** References {@link ItemDef.id}. */
  defId: string;
  /** Cached for save readability and for legacy items with no matching def. */
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  value: number;
  /** Measured size for species that track it. */
  sizeCm?: number;
  favorite?: boolean;
  /** Day the item entered the bag, used for "new" badges and sorting. */
  acquiredDay?: number;
}

export interface ItemStack {
  key: string;
  defId: string;
  items: InventoryItem[];
  get quantity(): number;
}
