/** Character customisation options. Everything here drives the 3D model. */

export interface Swatch {
  id: string;
  name: string;
  color: string;
}

export const SKIN_TONES: Swatch[] = [
  { id: 'skin.porcelain', name: 'Porcelain', color: '#f7ddc8' },
  { id: 'skin.sand', name: 'Sand', color: '#f0c7a4' },
  { id: 'skin.honey', name: 'Honey', color: '#dfa877' },
  { id: 'skin.amber', name: 'Amber', color: '#c48653' },
  { id: 'skin.chestnut', name: 'Chestnut', color: '#9a6039' },
  { id: 'skin.cocoa', name: 'Cocoa', color: '#70432a' },
  { id: 'skin.espresso', name: 'Espresso', color: '#4c2c1c' },
];

export const HAIR_COLORS: Swatch[] = [
  { id: 'hair.ink', name: 'Ink', color: '#241f22' },
  { id: 'hair.chestnut', name: 'Chestnut', color: '#593f36' },
  { id: 'hair.cinnamon', name: 'Cinnamon', color: '#8a5230' },
  { id: 'hair.wheat', name: 'Wheat', color: '#c9a55f' },
  { id: 'hair.ash', name: 'Ash', color: '#a8a4a0' },
  { id: 'hair.seafoam', name: 'Seafoam', color: '#6fbfa8' },
  { id: 'hair.plum', name: 'Plum', color: '#8a5f96' },
  { id: 'hair.coral', name: 'Coral', color: '#d9705f' },
];

export type HairStyleId = 'crop' | 'bob' | 'wave' | 'bun' | 'braids' | 'curls' | 'ponytail';

export interface HairStyleDef {
  id: HairStyleId;
  name: string;
}

export const HAIR_STYLES: HairStyleDef[] = [
  { id: 'crop', name: 'Cropped' },
  { id: 'bob', name: 'Bob' },
  { id: 'wave', name: 'Wave' },
  { id: 'bun', name: 'Top Bun' },
  { id: 'braids', name: 'Braids' },
  { id: 'curls', name: 'Curls' },
  { id: 'ponytail', name: 'Ponytail' },
];

export type OutfitId = 'tunic' | 'overalls' | 'raincoat' | 'sundress' | 'sweater' | 'apron';

export interface OutfitDef {
  id: OutfitId;
  name: string;
  /** Whether the model shows separate legs (trousers) or a skirt. */
  lower: 'trousers' | 'skirt' | 'shorts';
  price: number;
}

export const OUTFITS: OutfitDef[] = [
  { id: 'tunic', name: 'Cove Tunic', lower: 'trousers', price: 0 },
  { id: 'overalls', name: 'Field Overalls', lower: 'trousers', price: 320 },
  { id: 'sundress', name: 'Sundress', lower: 'skirt', price: 360 },
  { id: 'sweater', name: 'Knit Sweater', lower: 'trousers', price: 420 },
  { id: 'raincoat', name: 'Harbour Raincoat', lower: 'trousers', price: 520 },
  { id: 'apron', name: "Shopkeep's Apron", lower: 'shorts', price: 280 },
];

export const CLOTH_COLORS: Swatch[] = [
  { id: 'cloth.harbour', name: 'Harbour', color: '#405b9d' },
  { id: 'cloth.moss', name: 'Moss', color: '#5f8b52' },
  { id: 'cloth.clay', name: 'Clay', color: '#c26b45' },
  { id: 'cloth.blossom', name: 'Blossom', color: '#e39ab0' },
  { id: 'cloth.sand', name: 'Sand', color: '#e3cfa4' },
  { id: 'cloth.slate', name: 'Slate', color: '#4f5b63' },
  { id: 'cloth.cream', name: 'Cream', color: '#f4ecdc' },
  { id: 'cloth.plum', name: 'Plum', color: '#7a5288' },
  { id: 'cloth.marigold', name: 'Marigold', color: '#e0a63c' },
];

export type HatId = 'none' | 'strawHat' | 'beanie' | 'capBackwards' | 'sunVisor' | 'flowerCrown';

export interface HatDef {
  id: HatId;
  name: string;
  price: number;
}

export const HATS: HatDef[] = [
  { id: 'none', name: 'No Hat', price: 0 },
  { id: 'strawHat', name: 'Straw Hat', price: 180 },
  { id: 'beanie', name: 'Wool Beanie', price: 160 },
  { id: 'capBackwards', name: 'Backwards Cap', price: 200 },
  { id: 'sunVisor', name: 'Sun Visor', price: 150 },
  { id: 'flowerCrown', name: 'Flower Crown', price: 340 },
];

export type ShoeId = 'boots' | 'sandals' | 'sneakers' | 'wellies';

export const SHOES: { id: ShoeId; name: string; price: number }[] = [
  { id: 'boots', name: 'Walking Boots', price: 0 },
  { id: 'sneakers', name: 'Canvas Shoes', price: 140 },
  { id: 'sandals', name: 'Beach Sandals', price: 120 },
  { id: 'wellies', name: 'Rain Wellies', price: 220 },
];

/** The full appearance record persisted in the save file. */
export interface CharacterLook {
  skin: string;
  hairStyle: HairStyleId;
  hairColor: string;
  outfit: OutfitId;
  shirtColor: string;
  lowerColor: string;
  shoes: ShoeId;
  shoeColor: string;
  hat: HatId;
  hatColor: string;
}

export const DEFAULT_LOOK: CharacterLook = {
  skin: '#f0c7a4',
  hairStyle: 'wave',
  hairColor: '#593f36',
  outfit: 'tunic',
  shirtColor: '#405b9d',
  lowerColor: '#3d4a6b',
  shoes: 'boots',
  shoeColor: '#6b4a2c',
  hat: 'none',
  hatColor: '#e3cfa4',
};
