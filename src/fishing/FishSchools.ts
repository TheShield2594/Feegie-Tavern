import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  type Material,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { SPECIES_BY_ID } from '@/data/species';
import type { SpeciesDef } from '@/items/types';
import { Rng } from '@/util/rng';
import { mergeGeometries } from '@/util/three';
import {
  CREEK,
  SEA_LEVEL,
  creekDepth,
  creekSurfaceHeight,
  distanceToCreek,
  terrainHeight,
  waterDepth,
} from '@/world/heightfield';

interface Swimmer {
  x: number;
  z: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  wobble: number;
  /** Creek fish, rather than sea fish. They obey a different water surface. */
  fresh: boolean;
  /** Set while this fish has been recruited by a cast lure. */
  lured: Vector3 | null;
  luredTimer: number;
}

const COUNT = 46;
/** Creek fish. Fewer, smaller, and confined to the channel. */
const CREEK_COUNT = 18;

/**
 * The water a swimmer is in: its surface level and how deep it is there.
 *
 * Both come back together because working them out separately means sampling
 * the heightfield twice as often, and this runs for every fish every frame.
 */
function waterAt(fresh: boolean, x: number, z: number): { surface: number; depth: number } {
  if (!fresh) return { surface: SEA_LEVEL, depth: waterDepth(x, z) };
  // Outside the channel there is no creek surface worth computing.
  if (distanceToCreek(x, z) > CREEK.width * 2) return { surface: SEA_LEVEL, depth: 0 };
  const surface = creekSurfaceHeight(x, z);
  return { surface, depth: Math.max(0, surface - terrainHeight(x, z)) };
}

/**
 * The fish you can see in the water before you ever cast.
 *
 * Silhouettes rather than detailed models: a tapered body plus a tail, drawn as
 * two instanced meshes, drifting along the shelf. They matter because they tell
 * the player where fishing is worth trying.
 */
export class FishSchools {
  readonly group = new Group();
  private bodies: InstancedMesh;
  private tails: InstancedMesh;
  private swimmers: Swimmer[] = [];
  private dummy = new Object3D();

  constructor() {
    this.group.name = 'FishSchools';
    const rng = new Rng(5150);

    const material = createStylizedMaterial({
      color: '#1f4a5e',
      roughness: 0.6,
      transparent: true,
      opacity: 0.62,
    });

    const bodyGeometry = new SphereGeometry(0.5, 10, 7);
    bodyGeometry.scale(0.45, 0.32, 1);
    const tailGeometry = new SphereGeometry(0.32, 6, 5);
    tailGeometry.scale(0.08, 0.5, 0.55);

    const total = COUNT + CREEK_COUNT;
    this.bodies = new InstancedMesh(bodyGeometry, material, total);
    this.tails = new InstancedMesh(tailGeometry, material, total);
    this.bodies.frustumCulled = false;
    this.tails.frustumCulled = false;
    this.group.add(this.bodies, this.tails);

    const tint = new Color();
    let placed = 0;
    let attempts = 0;
    while (placed < COUNT && attempts < 4000) {
      attempts++;
      const x = rng.spread(105);
      const z = rng.spread(105);
      const depth = waterDepth(x, z);
      // Keep them on the shelf: deep enough to hide, shallow enough to see.
      if (depth < 0.9 || depth > 7) continue;
      this.swimmers.push({
        x, z,
        y: SEA_LEVEL - Math.min(depth * 0.55, 1.7),
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(0.55, 1.5),
        size: rng.range(0.55, 1.9),
        wobble: rng.range(0, 6.28),
        fresh: false,
        lured: null,
        luredTimer: 0,
      });
      tint.setHSL(0.52 + rng.range(-0.05, 0.06), 0.42, 0.2 + rng.range(0, 0.14));
      this.bodies.setColorAt(placed, tint);
      this.tails.setColorAt(placed, tint);
      placed++;
    }

    // Creek fish, spread down the length of the channel so every stretch of
    // the stream shows something moving. Without them the creek would read as
    // scenery, and a cast into it would have nothing to attract.
    const segments = CREEK.points.length - 1;
    let creekPlaced = 0;
    attempts = 0;
    while (creekPlaced < CREEK_COUNT && attempts < 3000) {
      attempts++;
      const along = rng.range(0.04, 0.96) * segments;
      const index = Math.min(segments - 1, Math.floor(along));
      const t = along - index;
      const a = CREEK.points[index];
      const b = CREEK.points[index + 1];
      const x = a.x + (b.x - a.x) * t + rng.range(-2.2, 2.2);
      const z = a.z + (b.z - a.z) * t + rng.range(-2.2, 2.2);
      const depth = creekDepth(x, z);
      if (depth < 0.45) continue;
      this.swimmers.push({
        x, z,
        y: creekSurfaceHeight(x, z) - Math.min(depth * 0.55, 0.5),
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(0.4, 0.95),
        size: rng.range(0.35, 0.85),
        wobble: rng.range(0, 6.28),
        fresh: true,
        lured: null,
        luredTimer: 0,
      });
      // Greener and paler than the sea fish, so the two read apart.
      tint.setHSL(0.28 + rng.range(-0.04, 0.05), 0.3, 0.26 + rng.range(0, 0.12));
      this.bodies.setColorAt(placed + creekPlaced, tint);
      this.tails.setColorAt(placed + creekPlaced, tint);
      creekPlaced++;
    }

    this.bodies.count = placed + creekPlaced;
    this.tails.count = placed + creekPlaced;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
  }

  /**
   * Sends the nearest fish to investigate a lure. Returns the closest one.
   *
   * `fresh` matters at the creek mouth, where sea fish and creek fish are a few
   * metres apart: a lure in the stream should never pull one in off the shelf.
   */
  attractTo(point: Vector3, radius = 9, fresh = false): Vector3 | null {
    let nearest: Swimmer | null = null;
    let nearestDist = radius * radius;
    for (const fish of this.swimmers) {
      if (fish.fresh !== fresh) continue;
      const d = (fish.x - point.x) ** 2 + (fish.z - point.z) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fish;
      }
    }
    if (!nearest) return null;
    nearest.lured = point.clone();
    nearest.luredTimer = 14;
    return new Vector3(nearest.x, nearest.y, nearest.z);
  }

  releaseLure(): void {
    for (const fish of this.swimmers) {
      fish.lured = null;
      fish.luredTimer = 0;
    }
  }

  /** Position of the fish currently closest to the lure, for the bite tell. */
  luredPosition(): Vector3 | null {
    const fish = this.swimmers.find((f) => f.lured);
    return fish ? new Vector3(fish.x, fish.y, fish.z) : null;
  }

  update(dt: number, time: number, cameraX: number, cameraZ: number): void {
    for (let i = 0; i < this.swimmers.length; i++) {
      const fish = this.swimmers[i];

      if (fish.lured) {
        fish.luredTimer -= dt;
        if (fish.luredTimer <= 0) {
          fish.lured = null;
        } else {
          // Circle in toward the lure rather than beelining, so the approach
          // reads as curiosity.
          const dx = fish.lured.x - fish.x;
          const dz = fish.lured.z - fish.z;
          const distance = Math.hypot(dx, dz);
          const desired = Math.atan2(dx, dz) + (distance > 2.2 ? 0 : 0.9);
          let delta = desired - fish.angle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          fish.angle += delta * Math.min(1, dt * 2.6);
        }
      } else {
        fish.angle += Math.sin(time * 0.5 + fish.wobble) * dt * 0.6;
      }

      const speed = fish.speed * (fish.lured ? 1.7 : 1);
      let nx = fish.x + Math.sin(fish.angle) * speed * dt;
      let nz = fish.z + Math.cos(fish.angle) * speed * dt;

      // Turn away from the shore — or the bank — rather than beaching.
      let water = waterAt(fish.fresh, nx, nz);
      const minDepth = fish.fresh ? 0.35 : 0.7;
      if (water.depth < minDepth || Math.hypot(nx, nz) > 150) {
        fish.angle += Math.PI * 0.6;
        nx = fish.x;
        nz = fish.z;
        // Re-read where the fish actually stayed. The rejected sample is from
        // outside the channel, where a creek fish's water reads as sea level —
        // using it would drop the fish through the streambed for a frame.
        water = waterAt(fish.fresh, nx, nz);
      }
      fish.x = nx;
      fish.z = nz;
      const settled = Math.max(water.depth, minDepth * 0.85);
      fish.y = fish.fresh
        ? water.surface - Math.min(settled * 0.5, 0.45) + Math.sin(time * 2.1 + fish.wobble) * 0.03
        : SEA_LEVEL - Math.min(settled * 0.5, 1.7) + Math.sin(time * 1.6 + fish.wobble) * 0.08;

      // Cull far fish rather than paying for their transforms every frame.
      const distanceSq = (fish.x - cameraX) ** 2 + (fish.z - cameraZ) ** 2;
      if (distanceSq > 90 * 90) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(i, this.dummy.matrix);
        this.tails.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const tailSwish = Math.sin(time * 7 * fish.speed + fish.wobble) * 0.35;

      this.dummy.position.set(fish.x, fish.y, fish.z);
      this.dummy.rotation.set(0, fish.angle, 0);
      this.dummy.scale.setScalar(fish.size);
      this.dummy.updateMatrix();
      this.bodies.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(
        fish.x - Math.sin(fish.angle) * 0.5 * fish.size,
        fish.y,
        fish.z - Math.cos(fish.angle) * 0.5 * fish.size,
      );
      this.dummy.rotation.set(0, fish.angle + tailSwish, 0);
      this.dummy.updateMatrix();
      this.tails.setMatrixAt(i, this.dummy.matrix);
    }

    this.bodies.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.bodies.dispose();
    this.tails.dispose();
  }
}

// ---------------------------------------------------------------------------
// Reef life
// ---------------------------------------------------------------------------

/** A sea creature sitting on the shelf, waiting to be swum down to. */
export interface ReefCollectible {
  id: number;
  speciesId: string;
  shape: ReefShape;
  x: number;
  y: number;
  z: number;
  /** Height above the seabed the creature holds station at. */
  hover: number;
  phase: number;
  /** In-game day it was taken; -1 while it is still down there. */
  takenOnDay: number;
}

type ReefShape = 'star' | 'jelly' | 'shell' | 'ammonite';

/** Depth band each habitat occupies on the shelf, in metres of water. */
const HABITAT_DEPTH: Record<string, [number, number]> = {
  shallow: [1.0, 2.6],
  beach: [1.0, 2.6],
  reef: [1.8, 5.0],
  deep: [4.6, 8.0],
};

/** How many creatures are down there at once. */
const REEF_SLOTS = 26;
/** Days before a collected creature's spot is worth visiting again. */
const REEF_RESPAWN_DAYS = 1;

function reefShapeOf(species: SpeciesDef): ReefShape {
  const shape = species.visual.shape;
  return shape === 'jelly' || shape === 'shell' || shape === 'ammonite' ? shape : 'star';
}

/**
 * The sea creatures a diver can collect.
 *
 * Built on the same instanced-and-culled pattern as {@link FishSchools} above,
 * and for the same reason: these are dozens of small bodies drifting over the
 * shelf, and drawing each one as its own object would cost more than the whole
 * island. One instanced mesh per silhouette family, coloured per instance from
 * the species table, so a new sea creature needs a table entry and nothing else.
 *
 * Placement is seeded, so the reef is in the same places every session — a spot
 * worth swimming back to is only worth it if it is still there tomorrow.
 */
export class ReefLife {
  readonly group = new Group();

  private meshes = new Map<ReefShape, InstancedMesh>();
  /** Slots per shape, in the order they occupy that shape's instance buffer. */
  private bySlot = new Map<ReefShape, ReefCollectible[]>();
  private collectibles: ReefCollectible[] = [];
  private dummy = new Object3D();
  private nextId = 1;

  constructor(species: SpeciesDef[]) {
    this.group.name = 'ReefLife';

    const eligible = species.filter((s) => HABITAT_DEPTH[s.habitat ?? ''] !== undefined);
    const rng = new Rng(9311);

    // Scatter first, then group by silhouette, so each instanced mesh is sized
    // to what actually landed rather than to the worst case.
    let attempts = 0;
    while (this.collectibles.length < REEF_SLOTS && attempts < 6000) {
      attempts++;
      const x = rng.spread(112);
      const z = rng.spread(112);
      const depth = waterDepth(x, z);
      if (depth < HABITAT_DEPTH.shallow[0]) continue;

      // The species is chosen by where the point landed rather than the other
      // way round: that is what keeps the deep-water creatures in deep water
      // without a second placement pass per habitat.
      const suited = eligible.filter((s) => {
        const band = HABITAT_DEPTH[s.habitat ?? ''];
        return band && depth >= band[0] && depth <= band[1];
      });
      if (suited.length === 0) continue;

      const pick = weightedReefPick(suited, rng);
      this.collectibles.push({
        id: this.nextId++,
        speciesId: pick.id,
        shape: reefShapeOf(pick),
        x,
        z,
        y: SEA_LEVEL - depth,
        // Jellies hang in the water; everything else sits on the bottom.
        hover: pick.visual.shape === 'jelly' ? rng.range(0.9, 2.1) : rng.range(0.08, 0.22),
        phase: rng.range(0, Math.PI * 2),
        takenOnDay: -1,
      });
    }

    for (const shape of ['star', 'jelly', 'shell', 'ammonite'] as ReefShape[]) {
      const slots = this.collectibles.filter((c) => c.shape === shape);
      if (slots.length === 0) continue;
      const mesh = new InstancedMesh(reefGeometry(shape), reefMaterial(), slots.length);
      mesh.name = `ReefLife_${shape}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.meshes.set(shape, mesh);
      this.bySlot.set(shape, slots);
      this.group.add(mesh);

      const tint = new Color();
      slots.forEach((slot, index) => {
        const def = SPECIES_BY_ID.get(slot.speciesId);
        mesh.setColorAt(index, tint.set(def?.visual.primary ?? '#cfe0f5'));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Everything currently down there, taken or not. Exposed for the map and tests. */
  get all(): readonly ReefCollectible[] {
    return this.collectibles;
  }

  /** Whether a creature is out at this hour, per its species' active hours. */
  private isActive(collectible: ReefCollectible, hour: number, day: number): boolean {
    if (collectible.takenOnDay >= 0 && day - collectible.takenOnDay < REEF_RESPAWN_DAYS) return false;
    const def = SPECIES_BY_ID.get(collectible.speciesId);
    if (!def?.activeHours) return true;
    const [from, to] = def.activeHours;
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  /**
   * The creature a diver at this point could reach, or null.
   *
   * Depth is part of the test, not just plan distance: a swimmer on the surface
   * is several metres above a shell on the bottom, and being able to collect it
   * without diving would make the dive decorative.
   */
  nearest(x: number, y: number, z: number, radius: number, hour: number, day: number): ReefCollectible | null {
    let best: ReefCollectible | null = null;
    let bestDistance = radius * radius;
    for (const collectible of this.collectibles) {
      if (!this.isActive(collectible, hour, day)) continue;
      const dy = collectible.y + collectible.hover - y;
      const d = (collectible.x - x) ** 2 + dy * dy + (collectible.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = collectible;
      }
    }
    return best;
  }

  /** Takes a creature. It is gone until the reef restocks. */
  collect(collectible: ReefCollectible, day: number): void {
    collectible.takenOnDay = day;
  }

  /** Restores the ones whose respawn has come round. Called on a new day. */
  refresh(day: number): void {
    for (const collectible of this.collectibles) {
      if (collectible.takenOnDay >= 0 && day - collectible.takenOnDay >= REEF_RESPAWN_DAYS) {
        collectible.takenOnDay = -1;
      }
    }
  }

  /** Collected state, so a reef stripped today is still stripped after a reload. */
  serialize(): { id: number; takenOnDay: number }[] {
    return this.collectibles
      .filter((c) => c.takenOnDay >= 0)
      .map((c) => ({ id: c.id, takenOnDay: c.takenOnDay }));
  }

  load(data: { id: number; takenOnDay: number }[], day: number): void {
    for (const collectible of this.collectibles) collectible.takenOnDay = -1;
    for (const entry of data) {
      const collectible = this.collectibles.find((c) => c.id === entry.id);
      if (collectible) collectible.takenOnDay = entry.takenOnDay;
    }
    this.refresh(day);
  }

  update(dt: number, time: number, hour: number, day: number, cameraX: number, cameraZ: number): void {
    void dt;
    for (const [shape, slots] of this.bySlot) {
      const mesh = this.meshes.get(shape);
      if (!mesh) continue;
      for (let i = 0; i < slots.length; i++) {
        const collectible = slots[i];
        const distanceSq = (collectible.x - cameraX) ** 2 + (collectible.z - cameraZ) ** 2;
        // Hidden rather than removed: a taken creature comes back, and so does
        // one whose hour has come round again.
        if (!this.isActive(collectible, hour, day) || distanceSq > 70 * 70) {
          this.dummy.position.set(0, -1000, 0);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.setScalar(0.001);
        } else {
          const bob = Math.sin(time * 0.8 + collectible.phase) * (collectible.hover > 0.5 ? 0.22 : 0.03);
          this.dummy.position.set(collectible.x, collectible.y + collectible.hover + bob, collectible.z);
          this.dummy.rotation.set(
            Math.sin(time * 0.4 + collectible.phase) * 0.12,
            collectible.phase,
            Math.cos(time * 0.35 + collectible.phase) * 0.1,
          );
          this.dummy.scale.setScalar(1);
        }
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
      mesh.dispose();
    }
  }
}

/** Rarer creatures are rarer on the shelf, not just rarer to land. */
function weightedReefPick(candidates: SpeciesDef[], rng: Rng): SpeciesDef {
  const weights = candidates.map((c) => (
    c.rarity === 'common' ? 100 : c.rarity === 'uncommon' ? 40 : c.rarity === 'rare' ? 14 : 5
  ));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.range(0, total);
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Shared material. Per-instance colour carries the species. */
function reefMaterial() {
  return createStylizedMaterial({ color: '#ffffff', roughness: 0.72 });
}

/**
 * One merged geometry per silhouette family, at roughly life size for the
 * creatures that use it. Deliberately the same shapes the item models and the
 * 2D icons use, so a creature on the seabed and the same creature in the bag
 * are recognisably one thing.
 */
function reefGeometry(shape: ReefShape): BufferGeometry {
  const parts: BufferGeometry[] = [];

  if (shape === 'star') {
    const core = new SphereGeometry(0.1, 10, 8);
    core.scale(1, 0.4, 1);
    parts.push(core);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new ConeGeometry(0.075, 0.3, 6);
      arm.rotateZ(-Math.PI / 2);
      arm.rotateY(-a);
      arm.translate(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
      parts.push(arm);
    }
  } else if (shape === 'jelly') {
    const bell = new SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    bell.scale(1, 0.8, 1);
    parts.push(bell);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tentacle = new CylinderGeometry(0.012, 0.006, 0.34, 4);
      tentacle.translate(Math.cos(a) * 0.15, -0.17, Math.sin(a) * 0.15);
      parts.push(tentacle);
    }
  } else if (shape === 'shell') {
    const dome = new SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.7, 1);
    parts.push(dome);
    const rim = new TorusGeometry(0.19, 0.022, 6, 18);
    rim.rotateX(Math.PI / 2);
    parts.push(rim);
  } else {
    // A stack of shrinking, offset rings approximates the spiral cheaply.
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const ring = new TorusGeometry(0.24 * (1 - t * 0.8), 0.042 * (1 - t * 0.6), 6, 14);
      const angle = t * Math.PI * 2.2;
      ring.translate(Math.cos(angle) * 0.06 * t, 0, Math.sin(angle) * 0.06 * t);
      parts.push(ring);
    }
  }

  return mergeGeometries(parts);
}
