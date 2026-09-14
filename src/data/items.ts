import type { ItemDef } from '@/items/types';
import { ALL_SPECIES } from './species';

/** Materials, produce, meals and everything else that is not a species. */
export const MATERIALS: ItemDef[] = [
  {
    id: 'mat.wood',
    name: 'Cove Wood',
    category: 'material',
    rarity: 'common',
    value: 18,
    description: 'Sun-dried branch wood. The backbone of every island project.',
    visual: { shape: 'log', primary: '#a9784c', secondary: '#d8b287', accent: '#6b4a2c' },
    stackable: true,
    maxStack: 99,
  },
  {
    id: 'mat.stone',
    name: 'Cove Stone',
    category: 'material',
    rarity: 'common',
    value: 20,
    description: 'Chipped from the headland. Heavier than it looks.',
    visual: { shape: 'stone', primary: '#8e9a95', secondary: '#c3cdc8', accent: '#5b6663' },
    stackable: true,
    maxStack: 99,
  },
  {
    id: 'mat.fiber',
    name: 'Meadow Fiber',
    category: 'material',
    rarity: 'common',
    value: 12,
    description: 'Twisted grass cord. Holds far more than it should.',
    visual: { shape: 'fiber', primary: '#c3b271', secondary: '#e8dcae', accent: '#7d6f3c' },
    stackable: true,
    maxStack: 99,
  },
];

/**
 * Forage: one thing worth stooping for in each of the outer regions.
 *
 * They are a separate category from `material` on purpose — materials go into
 * tools and public works, forage goes into the pot, and the recipes below take
 * a `forage` slot the way they already take a `fish` one.
 */
export const FORAGE: ItemDef[] = [
  {
    id: 'forage.ridgeHerb',
    name: 'Ridge Herb',
    category: 'forage',
    rarity: 'common',
    value: 40,
    description: 'Grows in the thin soil up on the High Meadow and smells of the whole ridge.',
    visual: { shape: 'leaf', primary: '#8fae72', secondary: '#d6e4bc', accent: '#4f6b3f' },
    stackable: true,
    maxStack: 30,
  },
  {
    id: 'forage.groveMushroom',
    name: 'Grove Mushroom',
    category: 'forage',
    rarity: 'common',
    value: 48,
    description: 'Comes up overnight in the West Grove, always on the north side of a pine.',
    visual: { shape: 'mushroom', primary: '#c96f55', secondary: '#f2e2c8', accent: '#6b4030' },
    stackable: true,
    maxStack: 30,
  },
  {
    id: 'forage.creekCress',
    name: 'Creek Cress',
    category: 'forage',
    rarity: 'common',
    value: 44,
    description: 'Peppery stuff that only grows where the water actually moves.',
    visual: { shape: 'leaf', primary: '#5f9e6a', secondary: '#bfe3c0', accent: '#2f5c38' },
    stackable: true,
    maxStack: 30,
  },
];

export const PRODUCE: ItemDef[] = [
  {
    id: 'crop.turnip',
    name: 'Turnip',
    category: 'crop',
    rarity: 'common',
    value: 75,
    description: 'Four days from seed to supper.',
    visual: { shape: 'root', primary: '#f2ecf6', secondary: '#c9a6d8', accent: '#6f9a55' },
    stackable: true,
    maxStack: 20,
  },
  {
    id: 'crop.pumpkin',
    name: 'Pumpkin',
    category: 'crop',
    rarity: 'common',
    value: 120,
    description: 'Heavy, ribbed, and absurdly pleased with itself.',
    visual: { shape: 'gourd', primary: '#e08e3c', secondary: '#f6bd6d', accent: '#5f7a3a' },
    stackable: true,
    maxStack: 20,
  },
  {
    id: 'crop.strawberry',
    name: 'Strawberry',
    category: 'crop',
    rarity: 'common',
    value: 95,
    description: 'Never quite makes it back to the kitchen intact.',
    visual: { shape: 'berry', primary: '#d94b57', secondary: '#f58b93', accent: '#4f8b47' },
    stackable: true,
    maxStack: 20,
  },
  {
    id: 'fruit.orchardPear',
    name: 'Orchard Pear',
    category: 'fruit',
    rarity: 'common',
    value: 55,
    description: 'From the trees behind the ridge. Best eaten warm off the branch.',
    visual: { shape: 'berry', primary: '#c8cf6b', secondary: '#e8ecad', accent: '#7d5a30' },
    stackable: true,
    maxStack: 20,
  },
];

export const SEEDS: ItemDef[] = [
  {
    id: 'seed.mixed',
    name: 'Seed Packet',
    category: 'seed',
    rarity: 'common',
    value: 16,
    description: 'Whatever Bruno had spare. Plant it and find out.',
    visual: { shape: 'seed', primary: '#c9a97b', secondary: '#efdcbc', accent: '#7a6242' },
    stackable: true,
    maxStack: 99,
  },
];

export const MEALS: ItemDef[] = [
  {
    id: 'meal.pearTart',
    name: 'Pear Tart',
    category: 'meal',
    rarity: 'crafted',
    value: 240,
    description: 'Orchard pear over a garden crop. A whole afternoon in one slice.',
    visual: { shape: 'dish', primary: '#e6c07a', secondary: '#f8e6c0', accent: '#b3733a' },
  },
  {
    id: 'meal.gardenStew',
    name: 'Garden Stew',
    category: 'meal',
    rarity: 'crafted',
    value: 310,
    description: 'Two crops, one pot, no particular recipe.',
    visual: { shape: 'dish', primary: '#c26b45', secondary: '#e8a97b', accent: '#5f8b4a' },
  },
  {
    id: 'meal.seasidePlate',
    name: 'Seaside Plate',
    category: 'meal',
    rarity: 'crafted',
    value: 430,
    description: 'The catch of the day next to whatever the tide offered.',
    visual: { shape: 'dish', primary: '#7fb8c6', secondary: '#d6eef3', accent: '#e0885f' },
  },
  {
    id: 'meal.ridgeTea',
    name: 'Ridge Tea',
    category: 'meal',
    rarity: 'crafted',
    value: 260,
    description: 'Two handfuls of whatever the high ground offered, steeped far too long.',
    visual: { shape: 'dish', primary: '#a8c48a', secondary: '#e4f0cf', accent: '#6b8a52' },
  },
  {
    id: 'meal.creekSupper',
    name: 'Creek Supper',
    category: 'meal',
    rarity: 'crafted',
    value: 480,
    description: 'Something out of the stream, something off its bank. They belong together.',
    visual: { shape: 'dish', primary: '#8fae72', secondary: '#e0ecc8', accent: '#c96f55' },
  },
];

export const ALL_ITEMS: ItemDef[] = [...ALL_SPECIES, ...MATERIALS, ...FORAGE, ...PRODUCE, ...SEEDS, ...MEALS];

export const ITEMS_BY_ID = new Map(ALL_ITEMS.map((i) => [i.id, i]));
export const ITEMS_BY_NAME = new Map(ALL_ITEMS.map((i) => [i.name.toLowerCase(), i]));

export function getItemDef(id: string): ItemDef | undefined {
  return ITEMS_BY_ID.get(id);
}
