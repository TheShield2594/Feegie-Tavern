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
  // The grove clearing and the orchard hollow. Both are kept small and well
  // short of the waterline: a wide pad this near the coast would lift the
  // beach with it and push the whole shoreline out.
  { x: -56, z: 4, radius: 6, falloff: 5, height: 4.5, surface: 'grass' },       // west grove clearing
  { x: 46, z: -16, radius: 8, falloff: 7, height: 5.0, surface: 'grass' },      // secret orchard
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
  // Farm spur, stopping on the near bank rather than in the stream.
  { ax: -26, az: 10, bx: -27, bz: 18, width: 3.2, surface: 'dirt' },
  // ...and its twin on the far bank, picked up from the bridge.
  { ax: -35, az: 9, bx: -39, bz: 18, width: 3.0, surface: 'dirt' },
  // Pip's house spur
  { ax: 24, az: -22, bx: 29, bz: -30, width: 3.4, surface: 'path' },
  // Cottage → foot of the meadow stairs. The stair run itself is deliberately
  // unpathed: flattening it would undo the steps Props cuts into the ridge.
  { ax: -16, az: -22, bx: -29, bz: -24, width: 3.4, surface: 'path' },
  // Head of the stairs → the meadow proper.
  { ax: -39, az: -34, bx: -42, bz: -40, width: 3.4, surface: 'path' },
  // West grove spur, off the end of the west road.
  { ax: -44, az: -8, bx: -52, bz: -1, width: 3.4, surface: 'path' },
  { ax: -52, az: -1, bx: -56, bz: 4, width: 3.2, surface: 'path' },
  // A short track off the east road that stops dead at the orchard gate.
  { ax: 43, az: 3, bx: 45.5, bz: -6, width: 3.0, surface: 'path' },
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
  /**
   * How deep the water stands over the channel floor. Less than `depth`, so
   * the carve leaves dry bank either side of the stream, and more than the
   * 0.55 m a cast needs, so the whole channel is fishable rather than just
   * its centreline.
   */
  fill: 0.8,
};

export interface Bridge {
  x: number;
  z: number;
  /** Yaw. The span runs along the bridge's local +Z. */
  rotation: number;
  /** Breadth of the walkway. */
  width: number;
  /** Length of the span, which has to clear the whole wet channel. */
  length: number;
  /** Height of the decking, taken from the banks the span lands on. */
  deck: number;
}

/**
 * Where the creek is bridged, so the path stays walkable.
 *
 * The span is sized and aimed at the channel rather than eyeballed: a bridge
 * shorter than the creek is wide, or turned along the water instead of across
 * it, is scenery rather than a crossing.
 */
export const BRIDGES: Bridge[] = [makeBridge(-34, 7, 4.2, 12)];

/** A crossing centred on the creek, square to the flow, with its deck levelled. */
function makeBridge(x: number, z: number, width: number, length: number): Bridge {
  // Aim the span across the flow: sample the centreline either side of the
  // crossing and take the perpendicular.
  const ahead = projectOntoCreek(x, z + 3);
  const behind = projectOntoCreek(x, z - 3);
  const flow = Math.atan2(ahead.x - behind.x, ahead.z - behind.z);
  const rotation = flow + Math.PI / 2;

  // Both abutments, then the higher one, so the deck never dips into a bank.
  const sx = Math.sin(rotation);
  const sz = Math.cos(rotation);
  const reach = length / 2;
  const deck = Math.max(
    terrainHeight(x + sx * reach, z + sz * reach),
    terrainHeight(x - sx * reach, z - sz * reach),
  ) + 0.1;

  return { x, z, rotation, width, length, deck };
}

/**
 * The ford where the west road meets the creek.
 *
 * The road has always crossed here; before the creek held water it did so by
 * walking through the ditch. Stones keep it a crossing now that there is a
 * stream in the way.
 */
export const FORD = { x: -36.4, z: -6.4, halfW: 5.6, halfD: 1.9 };

/** Deck height of the harbour pier above sea level, shared with `Props`. */
export const PIER_DECK_HEIGHT = 1.7;
/** Pier decking runs from this far short of the harbour landmark... */
export const PIER_START = -4.5;
/** ...to this far past it, along +Z. */
export const PIER_END = 22.5;

/**
 * A built surface the player stands on *above* the terrain: the pier decking.
 *
 * Platforms live outside `terrainHeight` on purpose. The terrain mesh, the
 * water's baked depth texture and the fish all read the raw heightfield, so
 * a platform folded into it would raise a block of seabed under the pier and
 * draw foam around it. Only the things that walk consult platforms.
 */
export interface Platform {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
  surface: Surface;
  /** Yaw of the platform's box, for anything that does not sit square to the world. */
  rotation?: number;
}

export const PLATFORMS: Platform[] = [
  {
    x: HARBOUR.x,
    z: HARBOUR.z + (PIER_START + PIER_END) / 2,
    halfW: 2.3,
    halfD: (PIER_END - PIER_START) / 2,
    height: PIER_DECK_HEIGHT,
    surface: 'wood',
  },
  // Creek crossings. Without these the bridge is a handrail you walk under and
  // the ford is a place to get wet.
  ...BRIDGES.map((bridge) => ({
    x: bridge.x,
    z: bridge.z,
    halfW: bridge.width / 2,
    halfD: bridge.length / 2,
    height: bridge.deck + 0.16,
    surface: 'wood' as Surface,
    rotation: bridge.rotation,
  })),
  {
    x: FORD.x,
    z: FORD.z,
    halfW: FORD.halfW,
    halfD: FORD.halfD,
    height: creekSurfaceHeight(FORD.x, FORD.z) + 0.06,
    surface: 'rock',
  },
];

/** The platform under a point, if any. */
export function platformAt(x: number, z: number): Platform | null {
  for (const p of PLATFORMS) {
    let dx = x - p.x;
    let dz = z - p.z;
    if (p.rotation) {
      // Into the platform's own frame; its local +Z is the yawed axis.
      const sin = Math.sin(p.rotation);
      const cos = Math.cos(p.rotation);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      dx = lx;
      dz = lz;
    }
    if (Math.abs(dx) <= p.halfW && Math.abs(dz) <= p.halfD) return p;
  }
  return null;
}

/**
 * A patch of ground the player has re-surfaced — a laid path, a stepping
 * stone, a gravel square.
 *
 * The compile-time `PATHS` table shapes the island: it flattens the ground and
 * is baked into the terrain mesh's vertex colours at load. Player-laid paths
 * cannot do either without re-meshing the island every time a slab goes down,
 * so they only repaint the *classification* — what the ground counts as for
 * footsteps, particles and anything else that asks what it is standing on.
 * The slab itself is a mesh the landscaping system owns.
 */
export interface SurfacePatch {
  id: string;
  x: number;
  z: number;
  radius: number;
  surface: Surface;
}

/** Overlay patches, bucketed into cells so `sampleSurface` stays cheap. */
const OVERLAY_CELL = 8;
const overlayBuckets = new Map<number, SurfacePatch[]>();
let overlayCount = 0;

function overlayKey(cx: number, cz: number): number {
  // A single integer key: the island is well inside ±1024 cells either way.
  return ((cx + 512) << 11) | (cz + 512);
}

/** Every bucket a patch touches, so a patch straddling a cell edge is found from both. */
function overlayCellsFor(patch: SurfacePatch): number[] {
  const minX = Math.floor((patch.x - patch.radius) / OVERLAY_CELL);
  const maxX = Math.floor((patch.x + patch.radius) / OVERLAY_CELL);
  const minZ = Math.floor((patch.z - patch.radius) / OVERLAY_CELL);
  const maxZ = Math.floor((patch.z + patch.radius) / OVERLAY_CELL);
  const keys: number[] = [];
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) keys.push(overlayKey(cx, cz));
  }
  return keys;
}

/** Registers a patch, filed under every cell it touches. */
export function addSurfacePatch(patch: SurfacePatch): void {
  for (const key of overlayCellsFor(patch)) {
    const bucket = overlayBuckets.get(key);
    if (bucket) bucket.push(patch);
    else overlayBuckets.set(key, [patch]);
  }
  overlayCount++;
}

/** Unregisters a patch by id, wherever it was filed. */
export function removeSurfacePatch(id: string): void {
  let removed = false;
  for (const [key, bucket] of overlayBuckets) {
    const index = bucket.findIndex((p) => p.id === id);
    if (index < 0) continue;
    bucket.splice(index, 1);
    removed = true;
    if (bucket.length === 0) overlayBuckets.delete(key);
  }
  if (removed) overlayCount = Math.max(0, overlayCount - 1);
}

/** Drops every patch — for loading a different island, or for a test. */
export function clearSurfacePatches(): void {
  overlayBuckets.clear();
  overlayCount = 0;
}

/** The surface a patch paints over a point, or null where none reaches it. */
export function surfacePatchAt(x: number, z: number): Surface | null {
  // The overwhelmingly common case is an island with nothing laid on it, and
  // this runs for every terrain vertex and every grounding sample.
  if (overlayCount === 0) return null;
  const bucket = overlayBuckets.get(overlayKey(Math.floor(x / OVERLAY_CELL), Math.floor(z / OVERLAY_CELL)));
  if (!bucket) return null;
  let best: Surface | null = null;
  let bestDistance = Infinity;
  for (const patch of bucket) {
    const d = Math.hypot(x - patch.x, z - patch.z);
    if (d > patch.radius || d >= bestDistance) continue;
    bestDistance = d;
    best = patch.surface;
  }
  return best;
}

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

export interface CreekProjection {
  /** Closest point on the centreline. */
  x: number;
  z: number;
  /** Distance from the queried point to it. */
  distance: number;
  /** 0 at the spring in the meadow, 1 where the creek meets the sea. */
  along: number;
}

/** The point on the creek's centreline nearest a world position. */
export function projectOntoCreek(x: number, z: number): CreekProjection {
  const segments = CREEK.points.length - 1;
  let best: CreekProjection = { x: CREEK.points[0].x, z: CREEK.points[0].z, distance: Infinity, along: 0 };
  for (let i = 0; i < segments; i++) {
    const a = CREEK.points[i];
    const b = CREEK.points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq < 1e-6 ? 0 : clamp01(((x - a.x) * dx + (z - a.z) * dz) / lengthSq);
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const distance = Math.hypot(x - cx, z - cz);
    if (distance < best.distance) best = { x: cx, z: cz, distance, along: (i + t) / segments };
  }
  return best;
}

/**
 * Height of the creek's water surface at a point, whether or not there is any
 * water there.
 *
 * The stream sits `CREEK.fill` above the floor of its own channel, which the
 * carve in `terrainHeight` has already cut, so the surface follows the island
 * downhill in one continuous run — pooling where the meadow and the terrace
 * flatten it, quickening where the ridge drops away. At the mouth it settles
 * onto the sea rather than meeting it at a step.
 */
export function creekSurfaceHeight(x: number, z: number): number {
  const projection = projectOntoCreek(x, z);
  const floor = terrainHeight(projection.x, projection.z);
  const tide = smoothstep(0.35, -0.7, floor);
  return lerp(floor + CREEK.fill, SEA_LEVEL, tide);
}

/** Depth of creek water over the ground at a point; 0 outside the channel. */
export function creekDepth(x: number, z: number): number {
  // Cheap rejection first: the carve dies out well before this.
  if (distanceToCreek(x, z) > CREEK.width * 2) return 0;
  return Math.max(0, creekSurfaceHeight(x, z) - terrainHeight(x, z));
}

/** True where the creek stands deep enough to read — and to fish — as water. */
export function isCreekWater(x: number, z: number): boolean {
  return creekDepth(x, z) > 0.08;
}

/**
 * How far a point is inside the coastline, 0 at the waterline and 1 well
 * inland. The outline is a noisy circle so the island has bays and headlands
 * rather than reading as a disc.
 */
export function coastRadius(x: number, z: number): number {
  const angle = Math.atan2(z, x);
  // Two noise bands: a slow one for bays, a fast one for a ragged edge.
  const bays = valueNoise2D(Math.cos(angle) * 1.6 + 8, Math.sin(angle) * 1.6 + 8, SHAPE_SEED) - 0.5;
  const detail = valueNoise2D(Math.cos(angle) * 6.2, Math.sin(angle) * 6.2, SHAPE_SEED + 3) - 0.5;
  let radius = 68 + bays * 34 + detail * 7;
  // Pull the south shore in to make a proper wide beach and a sheltered cove.
  radius -= smoothstep(-0.2, 1.2, Math.sin(angle)) * 10;
  // Push the north-east out for the lighthouse headland.
  radius += smoothstep(0.2, 1.0, Math.cos(angle - 0.9)) * 12;
  return radius;
}

/**
 * How far a point is inside the coastline, 0 at the waterline and 1 well
 * inland. The outline is a noisy circle so the island has bays and headlands
 * rather than reading as a disc.
 */
export function landMask(x: number, z: number): number {
  return clamp01((coastRadius(x, z) - Math.hypot(x, z)) / 34);
}

/** Raw inland elevation before flattening, paths and the creek. */
function baseElevation(x: number, z: number): number {
  const mask = landMask(x, z);
  if (mask <= 0) {
    // Seabed: slope away from *this* stretch of coast, so a bay shelves as
    // gently as it should while the open water still goes properly deep.
    // It starts a hair under sea level right at the coast and meets the beach
    // shelf continuously; the half-metre ledge it used to start from drew a
    // stair-stepped waterline out of the terrain triangles.
    const d = Math.hypot(x, z);
    const drop = smoothstep(-1.5, 24, d - coastRadius(x, z));
    return lerp(0, SEABED_FLOOR, drop);
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

  // Last, so a slab the player laid reads as what they laid, not as the grass
  // it was put down on.
  const patch = surfacePatchAt(x, z);
  if (patch && height >= SEA_LEVEL) surface = patch;

  return { height, surface, slope };
}

/**
 * What a character standing at a point is standing on: a platform where one
 * exists, the terrain everywhere else. Movement, footsteps, NPC grounding and
 * item drops read this; meshing reads `sampleSurface` directly.
 */
export function sampleWalkSurface(x: number, z: number): SurfaceSample {
  const platform = platformAt(x, z);
  if (platform) return { height: platform.height, surface: platform.surface, slope: 0 };
  return sampleSurface(x, z);
}

/** Height a character's feet rest at: deck over the pier, ground elsewhere. */
export function walkHeight(x: number, z: number): number {
  return platformAt(x, z)?.height ?? terrainHeight(x, z);
}

/** Cheap walkability test used by movement and by NPC navigation. */
export function isWalkable(x: number, z: number): boolean {
  if (Math.abs(x) > ISLAND_HALF - 2 || Math.abs(z) > ISLAND_HALF - 2) return false;
  // Decking is walkable regardless of the water beneath it.
  if (platformAt(x, z)) return true;
  const sample = sampleSurface(x, z);
  // Waist-deep water and cliff faces are out; shallow shoreline is fine.
  if (sample.height < SEA_LEVEL - 0.55) return false;
  return sample.slope < 0.72;
}

/**
 * How deep the player may swim out before the shelf gives way.
 *
 * The seabed bottoms out at {@link SEABED_FLOOR}, so stopping a little short of
 * it turns "the open ocean" into a soft wall the player meets by swimming into
 * cold dark water rather than by hitting an invisible line in the shallows.
 */
export const MAX_SWIM_DEPTH = 8.2;

/**
 * Where the player can *get to* in water, as opposed to where they can stand.
 *
 * {@link isWalkable} stops at waist depth, which is the right answer for
 * walking and the wrong one for a swimmer: it makes the whole shelf — and so
 * everything the dive is for — unreachable. This is the same test with the
 * water clause relaxed to the edge of the shelf.
 */
export function isSwimmable(x: number, z: number): boolean {
  if (Math.abs(x) > ISLAND_HALF - 2 || Math.abs(z) > ISLAND_HALF - 2) return false;
  if (platformAt(x, z)) return true;
  const sample = sampleSurface(x, z);
  if (sample.height < SEA_LEVEL) return SEA_LEVEL - sample.height <= MAX_SWIM_DEPTH;
  return sample.slope < 0.72;
}

/**
 * Walkability for villagers, who — unlike the player — should never be routed
 * through the stream. The crossings are bridged for a reason.
 */
export function isNavigable(x: number, z: number): boolean {
  if (!isWalkable(x, z)) return false;
  // The bridge and the ford are the crossings; everywhere else, stay dry.
  if (platformAt(x, z)) return true;
  return creekDepth(x, z) < 0.25;
}

/** True where the player can fish from: water ahead deep enough to hold fish. */
export function isFishableFrom(x: number, z: number, facingX: number, facingZ: number): boolean {
  const reach = 4.5;
  const tx = x + facingX * reach;
  const tz = z + facingZ * reach;
  if (creekDepth(tx, tz) > 0.35) return true;
  return sampleSurface(tx, tz).height < SEA_LEVEL - 0.35;
}

/** Approximate sea depth at a point; 0 on land and in the creek. */
export function waterDepth(x: number, z: number): number {
  return Math.max(0, SEA_LEVEL - terrainHeight(x, z));
}

/**
 * Depth of whatever water stands at a point — sea or creek.
 *
 * `waterDepth` stays sea-only because the ocean mesh, its baked depth texture
 * and the sea's own fish all reason about the shelf, and a stream running
 * twenty metres above sea level is not part of it. Anything that only cares
 * whether it is looking at water calls this instead.
 */
export function anyWaterDepth(x: number, z: number): number {
  return Math.max(waterDepth(x, z), creekDepth(x, z));
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
  'point.keeper': { x: 35, z: -43, label: "Keeper's Camp" },
  'meadow.high': { x: -41, z: -43, label: 'High Meadow' },
  'meadow.spring': { x: -38.5, z: -31, label: 'Meadow Spring' },
  'farm.terrace': { x: -37.5, z: 20, label: 'Garden Terrace' },
  'garden.shed': { x: -40, z: 17, label: 'Garden Shed' },
  'creek.stones': { x: FORD.x, z: FORD.z, label: 'Stepping Stones' },
  'grove.west': { x: -56, z: 4, label: 'West Grove' },
  'grove.elder': { x: -57, z: 1, label: 'The Elder Tree' },
  'orchard.gate': { x: 46, z: -7.6, label: 'Orchard Gate' },
  'orchard.secret': { x: 46, z: -16, label: 'Secret Orchard' },
};
