import type { SpeciesExtras } from '@/items/types';
import { LANDMARKS, SEA_LEVEL, isCreekWater, sampleSurface } from './heightfield';

/**
 * The island, divided into the places people name.
 *
 * The heightfield says where the ground is; this says where you *are*. It is
 * the one table that decides which creatures a region holds, what grows there
 * and what the game calls the place, so adding a region is a matter of adding
 * an entry rather than threading a new condition through fishing, the bug net
 * and the scatter rules separately.
 */

export type RegionId =
  | 'town'
  | 'beach'
  | 'sea'
  | 'creek'
  | 'meadow'
  | 'grove'
  | 'orchard'
  | 'garden'
  | 'point';

type Habitat = NonNullable<SpeciesExtras['habitat']>;

export interface RegionDef {
  id: RegionId;
  label: string;
  /** One line for the banner that shows when you walk in. */
  blurb: string;
  /** Habitats a species must declare to turn up here. */
  habitats: Habitat[];
  /** Centre and reach of the named area, for regions that have one. */
  centre?: { x: number; z: number; radius: number };
}

/**
 * Ordered most specific first. `regionAt` takes the first match, so a named
 * place wins over the stream running through it: the Garden Terrace is still
 * the Garden Terrace on the bank of its own creek.
 */
export const REGIONS: RegionDef[] = [
  {
    id: 'meadow',
    label: 'High Meadow',
    blurb: 'Above the ridge, where the creek starts',
    habitats: ['meadow', 'river'],
    centre: { x: -42, z: -40, radius: 19 },
  },
  {
    id: 'point',
    label: 'Lighthouse Point',
    blurb: 'The headland, and the light on it',
    habitats: ['shore', 'meadow'],
    centre: { x: 42, z: -46, radius: 17 },
  },
  {
    id: 'orchard',
    label: 'Secret Orchard',
    blurb: 'Behind the hedge on the east ridge',
    habitats: ['forest', 'meadow'],
    centre: { x: 46, z: -16, radius: 13 },
  },
  {
    id: 'garden',
    label: 'Garden Terrace',
    blurb: 'Watered by the creek, whatever the weather',
    habitats: ['meadow', 'river'],
    centre: { x: -34, z: 20, radius: 13 },
  },
  {
    id: 'grove',
    label: 'West Grove',
    blurb: 'Old pines, and the elder tree among them',
    habitats: ['forest'],
    centre: { x: -56, z: 4, radius: 15 },
  },
  {
    id: 'creek',
    label: 'The Creek',
    blurb: 'Fresh water, all the way down to the sea',
    habitats: ['river'],
  },
  {
    id: 'beach',
    label: 'Cozy Cove Beach',
    blurb: 'Sand, shells and the harbour pier',
    // `meadow` is here so the common butterflies still drift over the dunes.
    // Without it the beach is the one place on the island where a net catches
    // nothing at all, which is not the kind of distinctness this is for.
    habitats: ['beach', 'shore', 'shallow', 'meadow'],
  },
  {
    id: 'sea',
    label: 'The Cove',
    blurb: 'Open water off the shelf',
    habitats: ['shallow', 'deep', 'reef'],
  },
  {
    id: 'town',
    label: 'Cozy Cove',
    blurb: 'The square and everything around it',
    habitats: ['meadow', 'forest'],
  },
];

export const REGIONS_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/** Distance inside a named region, or Infinity for one that has no centre. */
export function distanceIntoRegion(id: RegionId, x: number, z: number): number {
  const centre = REGIONS_BY_ID.get(id)?.centre;
  if (!centre) return Infinity;
  return centre.radius - Math.hypot(x - centre.x, z - centre.z);
}

/** Whether a point is inside a named region's circle. */
export function isInRegion(id: RegionId, x: number, z: number): boolean {
  return distanceIntoRegion(id, x, z) > 0;
}

/** Which region a world position belongs to. */
export function regionAt(x: number, z: number): RegionId {
  for (const region of REGIONS) {
    if (region.centre) {
      if (Math.hypot(x - region.centre.x, z - region.centre.z) <= region.centre.radius) return region.id;
      continue;
    }
    if (region.id === 'creek') {
      if (isCreekWater(x, z)) return 'creek';
      continue;
    }
    if (region.id === 'beach') {
      const sample = sampleSurface(x, z);
      if (sample.surface === 'sand' && sample.height >= SEA_LEVEL) return 'beach';
      continue;
    }
    if (region.id === 'sea') {
      if (sampleSurface(x, z).height < SEA_LEVEL) return 'sea';
      continue;
    }
    return region.id;
  }
  return 'town';
}

/**
 * Whether a species turns up in a region.
 *
 * Two independent gates. `region` pins a species to exactly one place — the
 * reason to make the walk. `habitat` is the looser rule: a meadow butterfly is
 * happy in any of the grassy regions, but never in the pines.
 */
export function speciesBelongsIn(species: SpeciesExtras, region: RegionId): boolean {
  if (species.region && species.region !== region) return false;
  if (!species.habitat) return true;
  const def = REGIONS_BY_ID.get(region);
  return !!def && def.habitats.includes(species.habitat);
}

/** The label shown when the player crosses into a region. */
export function regionLabel(id: RegionId): string {
  return REGIONS_BY_ID.get(id)?.label ?? 'Cozy Cove';
}

/** The named anchor at the heart of a region, where one exists. */
export function regionAnchor(id: RegionId): { x: number; z: number } | null {
  const centre = REGIONS_BY_ID.get(id)?.centre;
  if (centre) return { x: centre.x, z: centre.z };
  const fallback: Partial<Record<RegionId, string>> = {
    creek: 'creek.stones',
    beach: 'beach.pier',
    town: 'square.center',
  };
  const key = fallback[id];
  const landmark = key ? LANDMARKS[key] : undefined;
  return landmark ? { x: landmark.x, z: landmark.z } : null;
}
