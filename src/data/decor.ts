import type { Surface } from '@/world/heightfield';

/**
 * What the player can put down outdoors.
 *
 * The indoor catalogue in ./furniture.ts is bought a piece at a time and each
 * piece is unique. Outdoor decoration is the opposite: you want eleven fence
 * panels and a run of lamps, so these are priced per piece and bought at the
 * moment of placing rather than owned in a list.
 */

export type DecorKind = 'flower' | 'bush' | 'fence' | 'bench' | 'lamp' | 'sign' | 'path';

export interface DecorDef {
  id: string;
  name: string;
  kind: DecorKind;
  description: string;
  /** Shells, charged on placement and returned in full when the piece is taken up. */
  price: number;
  /** Materials, charged and returned the same way. */
  cost?: { wood?: number; stone?: number; fiber?: number };
  /** Radius of the piece's footprint, in metres. */
  radius: number;
  /** Whether the player walks into it or over it. */
  solid: boolean;
  /**
   * Repaints the ground it stands on. Only paths do: everything else is an
   * object sitting on the island, not a change to the island.
   */
  surface?: Surface;
  /** Colourways offered when placing. The first is the default. */
  tints?: string[];
  light?: { color: string; intensity: number };
  /**
   * Counts as greenery toward the island's rating. Flowers and bushes do; a
   * lamp post, however welcome, is not a garden.
   */
  greenery?: boolean;
}

export const DECOR: DecorDef[] = [
  {
    id: 'decor.flowerBed',
    name: 'Flower Bed',
    kind: 'flower',
    description: 'A tilled square and a dozen blooms. The island notices.',
    price: 60,
    cost: { fiber: 1 },
    radius: 0.9,
    solid: false,
    tints: ['#f4b5c7', '#f5d66c', '#c9b3f6', '#fdfdfb', '#f2946b', '#8fd0e8'],
    greenery: true,
  },
  {
    id: 'decor.shrub',
    name: 'Round Shrub',
    kind: 'bush',
    description: 'Clipped, obliging, and good at hiding a dull corner.',
    price: 45,
    cost: { fiber: 1 },
    radius: 0.7,
    solid: true,
    tints: ['#6f9a55', '#5b8a4a', '#7fa86a'],
    greenery: true,
  },
  {
    id: 'decor.picketFence',
    name: 'Picket Fence',
    kind: 'fence',
    description: 'One panel. Lay a run of them and you have a garden.',
    price: 30,
    cost: { wood: 1 },
    radius: 1.2,
    solid: true,
  },
  {
    id: 'decor.gardenBench',
    name: 'Garden Bench',
    kind: 'bench',
    description: 'Slatted, iron-legged, and pointed at whatever is worth looking at.',
    price: 140,
    cost: { wood: 2 },
    radius: 1.1,
    solid: true,
  },
  {
    id: 'decor.gardenLamp',
    name: 'Garden Lamp',
    kind: 'lamp',
    description: 'Comes on by itself at dusk, like the ones in the square.',
    price: 180,
    cost: { stone: 1 },
    radius: 0.5,
    solid: true,
    light: { color: '#ffd9a0', intensity: 2.4 },
  },
  {
    id: 'decor.signpost',
    name: 'Signpost',
    kind: 'sign',
    description: 'Says WELCOME. Nobody has ever asked it to say anything else.',
    price: 70,
    cost: { wood: 1 },
    radius: 0.5,
    solid: true,
  },
  {
    id: 'decor.steppingStones',
    name: 'Stepping Stones',
    kind: 'path',
    description: 'Flagstones set into the turf. Lay them end to end for a path.',
    price: 25,
    cost: { stone: 1 },
    radius: 1.0,
    solid: false,
    surface: 'path',
  },
];

export const DECOR_BY_ID = new Map(DECOR.map((d) => [d.id, d]));
