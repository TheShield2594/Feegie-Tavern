import { clamp01, lerp, smoothstep } from '@/util/math';
import { fbm2D, valueNoise2D } from '@/util/rng';

/**
 * The island's shape, expressed as pure functions.
 *
 * Terrain meshing, object scattering, player grounding, NPC navigation and the
 * minimap all call into here, so there is exactly one definition of where the
 * ground is. Everything is deterministic — no state, no randomness at runtime.
 */

export const ISLAND_HALF = 90;
export const SEA_LEVEL = 0;
/** Below this depth the seabed stops dropping. */
export const SEABED_FLOOR = -9;
const SHAPE_SEED = 41;

export type Surface = 'grass' | 'sand' | 'rock' | 'path' | 'plaza' | 'dirt' | 'water' | 'wood';

/** A flattened area — plazas, building pads, the farm terrace. */
interface FlatZone {
  x: number;
  z: number;
  radius: number;
  /** Distance over which the flattening blends back into the terrain. */
  falloff: number;
  height: number;
  surface: Surface;
}

/** A walking route. Paths flatten gently and repaint the surface. */
interface PathSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  surface: Surface;
}

/**
 * Distance from the island's centre to the waterline along a compass bearing.
 * Measured against the raw elevation (before flattening) so it can be used to
 * position the flat zones and landmarks that shape the coast.
 */
export function shoreDistance(angle: number): number {
  let inside = 0;
  let outside = ISLAND_HALF;
  for (let i = 0; i < 24; i++) {
    const mid = (inside + outside) / 2;
    if (baseElevation(Math.cos(angle) * mid, Math.sin(angle) * mid) > SEA_LEVEL) inside = mid;
    else outside = mid;
  }
  return inside;
}

/** A point on the beach, `inland` metres back from the waterline. */
export function shorePoint(angle: number, inland = 0): { x: number; z: number } {
  const d = Math.max(4, shoreDistance(angle) - inland);
  return { x: Math.cos(angle) * d, z: Math.sin(angle) * d };
}

/** The harbour sits in the sheltered south-east bay. */
const HARBOUR = shorePoint(1.25, 8);
const BEACH_LOG = shorePoint(1.62, 7);
const BEACH_DUNES = shorePoint(2.05, 9);

export const FLAT_ZONES: FlatZone[] = [
  // Town square: the visual anchor of the vertical slice.
  { x: 0, z: 0, radius: 10.5, falloff: 7, height: 2.6, surface: 'plaza' },
  // Building pads, so nothing sits on a slope.
  { x: -25, z: -20, radius: 9.5, falloff: 6, height: 3.5, surface: 'grass' },   // player cottage
  { x: 22, z: -13, radius: 10, falloff: 6, height: 3.2, surface: 'grass' },     // general store
  { x: -6, z: -40, radius: 14, falloff: 8, height: 4.6, surface: 'grass' },     // museum
  { x: 30, z: -34, radius: 9, falloff: 6, height: 4.2, surface: 'grass' },      // Pip's house
  { x: -46, z: -8, radius: 9, falloff: 6, height: 3.4, surface: 'grass' },      // Mallow's house
  { x: 44, z: 6, radius: 9, falloff: 6, height: 2.8, surface: 'grass' },        // Bruno's house
  { x: 0, z: -54, radius: 12, falloff: 9, height: 8.4, surface: 'grass' },      // town hall terrace
  { x: 42, z: -46, radius: 11, falloff: 10, height: 13.5, surface: 'rock' },    // lighthouse point
  { x: -44, z: -38, radius: 15, falloff: 12, height: 9.5, surface: 'grass' },   // high meadow
  { x: -34, z: 20, radius: 12, falloff: 8, height: 2.2, surface: 'dirt' },      // farm terrace
  { x: HARBOUR.x, z: HARBOUR.z, radius: 5, falloff: 6, height: 1.1, surface: 'sand' }, // harbour apron
];

export const PATHS: PathSegment[] = [
  // Square → cottage
  { ax: -6, az: -12, bx: -22, bz: -18, width: 4.2, surface: 'path' },
  // Square → shop
  { ax: 7, az: -9, bx: 19, bz: -12, width: 4.2, surface: 'path' },
  // Square → museum
  { ax: -3, az: -15, bx: -5, bz: -30, width: 4.4, surface: 'path' },
  { ax: -5, az: -30, bx: -6, bz: -38, width: 4.4, surface: 'path' },
  // Square → beach
  { ax: 2, az: 15, bx: 5, bz: 30, width: 4.6, surface: 'path' },
  { ax: 5, az: 30, bx: HARBOUR.x, bz: HARBOUR.z - 6, width: 4.4, surface: 'path' },
  // Beach boardwalk east
  { ax: HARBOUR.x, az: HARBOUR.z - 6, bx: HARBOUR.x + 14, bz: HARBOUR.z - 3, width: 3.4, surface: 'wood' },
  // Square → east residential
  { ax: 12, az: 4, bx: 32, bz: 4, width: 4.0, surface: 'path' },
  { ax: 32, az: 4, bx: 42, bz: 6, width: 3.8, surface: 'path' },
  // Square → west grove
  { ax: -12, az: -2, bx: -34, bz: -6, width: 4.0, surface: 'path' },
  { ax: -34, az: -6, bx: -44, bz: -8, width: 3.8, surface: 'path' },
  // Museum → town hall → lighthouse
  { ax: -6, az: -44, bx: -2, bz: -50, width: 4.0, surface: 'path' },
  { ax: 2, az: -54, bx: 22, bz: -52, width: 4.2, surface: 'path' },
  { ax: 22, az: -52, bx: 38, bz: -47, width: 4.0, surface: 'path' },
  // Farm spur
  { ax: -26, az: 10, bx: -33, bz: 17, width: 3.2, surface: 'dirt' },
  // Pip's house spur
  { ax: 24, az: -22, bx: 29, bz: -30, width: 3.4, surface: 'path' },
];

/** The creek, as a curve sampled by the height function. */
export const CREEK = {
  /** Control points from the meadow down to the sea. */
  points: [
    { x: -46, z: -34 },
    { x: -40, z: -19 },
    { x: -36, z: -4 },
    { x: -33, z: 12 },
    { x: -29, z: 27 },
    { x: -24, z: 42 },
  ],
  width: 4.6,
  depth: 1.9,
};

/** Where the creek is bridged, so the path stays walkable. */
export const BRIDGES = [{ x: -34, z: 7, rotation: Math.PI / 2 - 0.22, width: 8, length: 4.5 }];

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-6) return Math.hypot(px - ax, pz - az);
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / lengthSq);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance to the creek's centreline. */
export function distanceToCreek(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < CREEK.points.length - 1; i++) {
    const a = CREEK.points[i];
    const b = CREEK.points[i + 1];
    best = Math.min(best, distanceToSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/**
 * How far a point is inside the coastline, 0 at the waterline and 1 well
 * inland. The outline is a noisy circle so the island has bays and headlands
 * rather than reading as a disc.
 */
export function landMask(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const angle = Math.atan2(z, x);
  // Two noise bands: a slow one for bays, a fast one for a ragged edge.
  const bays = valueNoise2D(Math.cos(angle) * 1.6 + 8, Math.sin(angle) * 1.6 + 8, SHAPE_SEED) - 0.5;
  const detail = valueNoise2D(Math.cos(angle) * 6.2, Math.sin(angle) * 6.2, SHAPE_SEED + 3) - 0.5;
  let radius = 68 + bays * 34 + detail * 7;
  // Pull the south shore in to make a proper wide beach and a sheltered cove.
  radius -= smoothstep(-0.2, 1.2, Math.sin(angle)) * 10;
  // Push the north-east out for the lighthouse headland.
  radius += smoothstep(0.2, 1.0, Math.cos(angle - 0.9)) * 12;
  return clamp01((radius - d) / 34);
}

/** Raw inland elevation before flattening, paths and the creek. */
function baseElevation(x: number, z: number): number {
  const mask = landMask(x, z);
  if (mask <= 0) {
    // Seabed: slope away from the coast and level off at the floor.
    const d = Math.hypot(x, z);
    const drop = smoothstep(0, 40, d - 68);
    return lerp(-0.6, SEABED_FLOOR, drop);
  }

  const rolling = fbm2D(x * 0.012, z * 0.012, 4, SHAPE_SEED) * 7.5;
  const detail = fbm2D(x * 0.055, z * 0.055, 3, SHAPE_SEED + 11) * 1.35;

  // Northern ridge: the high meadow and the cliffs behind it.
  const ridge = smoothstep(-20, -58, z) * (11 + fbm2D(x * 0.02, z * 0.02, 3, SHAPE_SEED + 5) * 9);
  // The lighthouse headland is higher still.
  const headland = smoothstep(26, 6, Math.hypot(x - 42, z - -46)) * 8;

  const inland = rolling + detail + ridge + headland;

  // A genuine beach shelf: the first several metres of land stay flat and low
  // before the terrain proper takes over, which is what gives the island sand
  // to walk on rather than grass meeting water at a cliff edge.
  const beach = smoothstep(0, 0.16, mask) * 1.15;
  const blend = smoothstep(0.16, 0.58, mask);
  return beach + (inland - beach) * blend;
}

interface SurfaceSample {
  height: number;
  surface: Surface;
  /** Steepness, 0 flat and 1 near-vertical. Used for rock blending and walkability. */
  slope: number;
}

function applyFlatZones(x: number, z: number, height: number): { height: number; surface: Surface | null } {
  let result = height;
  let surface: Surface | null = null;
  let strongest = 0;

  for (const zone of FLAT_ZONES) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d > zone.radius + zone.falloff) continue;
    const influence = 1 - smoothstep(zone.radius, zone.radius + zone.falloff, d);
    if (influence <= 0) continue;
    result = lerp(result, zone.height, influence);
    if (influence > strongest && d < zone.radius) {
      strongest = influence;
      surface = zone.surface;
    }
  }
  return { height: result, surface };
}

function applyPaths(x: number, z: number, height: number): { height: number; surface: Surface | null } {
  let result = height;
  let surface: Surface | null = null;
  let best = 0;

  for (const path of PATHS) {
    const d = distanceToSegment(x, z, path.ax, path.az, path.bx, path.bz);
    const half = path.width * 0.5;
    if (d > half + 3) continue;
    const core = 1 - smoothstep(half * 0.6, half + 1.4, d);
    if (core <= 0) continue;
    // Paths cut through undulation so walking a route never feels bumpy.
    const flattened = lerp(result, sampleSmoothed(x, z), core * 0.75);
    result = flattened;
    if (core > best) {
      best = core;
      if (core > 0.28) surface = path.surface;
    }
  }
  return { height: result, surface };
}

/** Elevation with building pads and plazas applied, but before paths. */
function zonedElevation(x: number, z: number): number {
  return applyFlatZones(x, z, baseElevation(x, z)).height;
}

/**
 * Average of the surroundings — used to level paths without flattening them
 * fully. It samples the *zoned* elevation so a path crossing a building pad or
 * the harbour apron does not drag the ground back up to the raw terrain.
 */
function sampleSmoothed(x: number, z: number): number {
  const r = 4;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    sum += zonedElevation(x + Math.cos(a) * r, z + Math.sin(a) * r);
  }
  return sum / 4;
}

/** The authoritative ground height at a world position. */
export function terrainHeight(x: number, z: number): number {
  let h = baseElevation(x, z);

  const flat = applyFlatZones(x, z, h);
  h = flat.height;

  const path = applyPaths(x, z, h);
  h = path.height;

  // Creek: carve a channel, but leave the bridged crossings alone.
  const creekDistance = distanceToCreek(x, z);
  if (creekDistance < CREEK.width * 2) {
    const carve = 1 - smoothstep(CREEK.width * 0.5, CREEK.width * 1.8, creekDistance);
    h -= carve * CREEK.depth;
  }

  return h;
}

/** Terrain height plus surface classification and slope, in one pass. */
export function sampleSurface(x: number, z: number): SurfaceSample {
  const height = terrainHeight(x, z);

  // Central difference for the normal; 0.6 m is fine enough for gameplay.
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const slope = clamp01(Math.hypot(dx, dz) / (2 * e) / 1.6);

  let surface: Surface;
  if (height < SEA_LEVEL - 0.05) {
    surface = 'water';
  } else if (height < 1.75) {
    surface = 'sand';
  } else if (slope > 0.62) {
    surface = 'rock';
  } else {
    surface = 'grass';
  }

  const flat = applyFlatZones(x, z, height);
  if (flat.surface && height >= 1.4) surface = flat.surface;

  const path = applyPaths(x, z, height);
  if (path.surface) surface = path.surface;

  // A muddy band either side of the creek reads as a bank.
  const creekDistance = distanceToCreek(x, z);
  if (creekDistance < CREEK.width * 0.85 && height > SEA_LEVEL) surface = 'dirt';

  return { height, surface, slope };
}

/** Cheap walkability test used by movement and by NPC navigation. */
export function isWalkable(x: number, z: number): boolean {
  if (Math.abs(x) > ISLAND_HALF - 2 || Math.abs(z) > ISLAND_HALF - 2) return false;
  const sample = sampleSurface(x, z);
  // Waist-deep water and cliff faces are out; shallow shoreline is fine.
  if (sample.height < SEA_LEVEL - 0.55) return false;
  return sample.slope < 0.72;
}

/** True where the player can fish from: land next to water deep enough to hold fish. */
export function isFishableFrom(x: number, z: number, facingX: number, facingZ: number): boolean {
  const reach = 4.5;
  const target = sampleSurface(x + facingX * reach, z + facingZ * reach);
  return target.height < SEA_LEVEL - 0.35;
}

/** Approximate water depth at a point; 0 on land. */
export function waterDepth(x: number, z: number): number {
  return Math.max(0, SEA_LEVEL - terrainHeight(x, z));
}

/** Named anchors used by NPC schedules, warps and the map. */
export const LANDMARKS: Record<string, { x: number; z: number; label: string }> = {
  'square.center': { x: 0, z: 0, label: 'Town Square' },
  'square.bench': { x: 7, z: 6, label: 'Square Bench' },
  'square.flowerbed': { x: -8, z: 6, label: 'Flower Beds' },
  'shop.front': { x: 20, z: -6, label: 'General Store' },
  'shop.counter': { x: 22, z: -13, label: 'Store Counter' },
  'museum.steps': { x: -6, z: -31, label: 'Museum Steps' },
  'museum.desk': { x: -6, z: -40, label: 'Curator Desk' },
  'townhall.front': { x: 0, z: -47, label: 'Town Hall' },
  'home.player': { x: -25, z: -14, label: 'Your Cottage' },
  'home.pip': { x: 30, z: -28, label: "Pip's House" },
  'home.mallow': { x: -46, z: -3, label: "Mallow's House" },
  'home.bruno': { x: 44, z: 11, label: "Bruno's House" },
  'beach.pier': { x: HARBOUR.x, z: HARBOUR.z, label: 'Harbour Pier' },
  'beach.log': { x: BEACH_LOG.x, z: BEACH_LOG.z, label: 'Driftwood Log' },
  'beach.dunes': { x: BEACH_DUNES.x, z: BEACH_DUNES.z, label: 'Dunes' },
  'lighthouse.point': { x: 42, z: -46, label: 'Lighthouse Point' },
  'meadow.high': { x: -44, z: -38, label: 'High Meadow' },
  'farm.terrace': { x: -34, z: 20, label: 'Garden Terrace' },
  'grove.west': { x: -56, z: 6, label: 'West Grove' },
  'orchard.secret': { x: 50, z: 22, label: 'Secret Orchard' },
};
