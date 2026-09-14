import type { ItemCategory } from '@/items/types';

export interface RecipeDef {
  id: string;
  /** Names preserved from the prototype. */
  name: string;
  resultItemId: string;
  /** Ingredients described by category so any fish works in a fish slot. */
  needs: ItemCategory[];
  /** Unlocked once the player has cooked this many dishes. */
  unlockAfterCooked: number;
  description: string;
}

export const RECIPES: RecipeDef[] = [
  {
    id: 'recipe.pearTart',
    name: 'Pear Tart',
    resultItemId: 'meal.pearTart',
    needs: ['fruit', 'crop'],
    unlockAfterCooked: 0,
    description: 'One orchard pear, one garden crop, and a very hot oven.',
  },
  {
    id: 'recipe.gardenStew',
    name: 'Garden Stew',
    resultItemId: 'meal.gardenStew',
    needs: ['crop', 'crop'],
    unlockAfterCooked: 0,
    description: 'Whatever came out of the ground today.',
  },
  {
    id: 'recipe.seasidePlate',
    name: 'Seaside Plate',
    resultItemId: 'meal.seasidePlate',
    needs: ['fish', 'sea'],
    unlockAfterCooked: 2,
    description: 'The catch of the day, plus whatever the tide offered.',
  },
];

export interface CraftRecipeDef {
  id: string;
  name: string;
  description: string;
  /** Tool this upgrades, if any. */
  tool?: 'rod' | 'net' | 'shovel' | 'axe' | 'wateringCan';
  maxLevel?: number;
  cost: (level: number) => { wood: number; stone: number; fiber: number; coins: number };
}

export const CRAFTING: CraftRecipeDef[] = [
  {
    id: 'craft.rod',
    name: 'Fishing Rod',
    tool: 'rod',
    maxLevel: 3,
    description: 'A better rod holds a bite longer and lands rarer fish.',
    cost: (level) => ({ wood: 2 + level * 2, stone: 1 + level, fiber: level, coins: 180 * level }),
  },
  {
    id: 'craft.net',
    name: 'Bug Net',
    tool: 'net',
    maxLevel: 3,
    description: 'A wider hoop makes skittish insects far less skittish.',
    cost: (level) => ({ wood: 2 + level * 2, stone: 1 + level, fiber: level * 2, coins: 180 * level }),
  },
  {
    id: 'craft.shovel',
    name: 'Shovel',
    tool: 'shovel',
    maxLevel: 3,
    description: 'Digs faster and turns up more per swing.',
    cost: (level) => ({ wood: 2 + level * 2, stone: 2 + level * 2, fiber: 0, coins: 180 * level }),
  },
  {
    id: 'craft.axe',
    name: 'Axe',
    tool: 'axe',
    maxLevel: 3,
    description: 'Takes wood from a tree without taking the tree.',
    cost: (level) => ({ wood: 1 + level, stone: 3 + level * 2, fiber: level, coins: 200 * level }),
  },
  {
    id: 'craft.wateringCan',
    name: 'Watering Can',
    tool: 'wateringCan',
    maxLevel: 3,
    description: 'Waters a wider patch of soil in one pass.',
    cost: (level) => ({ wood: level, stone: 2 + level, fiber: 2 + level, coins: 150 * level }),
  },
];
