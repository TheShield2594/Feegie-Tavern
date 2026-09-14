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
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import type { SpeciesDef } from '@/items/types';
import { Rng } from '@/util/rng';
import { mergeGeometries } from '@/util/three';
import {
  SEA_LEVEL,
  coastRadius,
  creekDepth,
  distanceToCreek,
  isWalkable,
  sampleSurface,
  type Surface,
} from '@/world/heightfield';

/**
 * What an insect hovers above at a point.
 *
 * The stream's surface, where there is one, rather than the bed under it — a
 * damselfly holding station a metre over the streambed would be a metre under
 * the water.
 */
function hoverFloor(x: number, z: number): number {
  const ground = sampleSurface(x, z);
  return ground.height + creekDepth(x, z);
}

/**
 * The insects flying over the island.
 *
 * Before this, catching a bug was a table roll behind a net animation: nothing
 * was ever there to see, so there was nothing to walk up to and nothing to
 * scare off. These are actual entities with positions, and the net now targets
 * the one in front of the player rather than the catalogue.
 *
 * Drawn with the same instanced-and-culled approach as the fish schools — two
 * instanced meshes per silhouette family, bodies and wings — so a live
 * population costs a handful of draw calls however many are in the air.
 *
 * The population roams with the player rather than covering the whole island:
 * a slot that ends up far behind is recycled somewhere ahead, which keeps the
 * count fixed while making every part of the island look inhabited.
 */

export type InsectShape = 'butterfly' | 'beetle' | 'dragonfly';

export type InsectState = 'drift' | 'settled' | 'fleeing';

export interface Insect {
  id: number;
  speciesId: string;
  shape: InsectShape;
  x: number;
  y: number;
  z: number;
  /** The point it keeps coming back to — a flower bed, a trunk, a reed. */
  homeX: number;
  homeZ: number;
  /** Ground height under the home point. */
  groundY: number;
  angle: number;
  speed: number;
  phase: number;
  state: InsectState;
  /** Seconds left in the current state. */
  timer: number;
  /** Seconds until the slot re-asks whether this species still belongs here. */
  recheck: number;
  /** Seconds until the ground under it is sampled again. */
  resample: number;
  /** Where it last tested that it belonged, so the test runs per metre, not per frame. */
  checkX: number;
  checkZ: number;
  /** False while the slot is empty — nothing was flying where it tried to spawn. */
  alive: boolean;
}

/**
 * How the live population is divided between the silhouette families.
 *
 * A slot's silhouette is fixed for the life of the pool — swapping a butterfly
 * slot to a beetle would mean resizing two instance buffers mid-frame — so the
 * split here is also the split of what can be flying at any moment.
 */
const FAMILY_SHARE: Record<InsectShape, number> = { butterfly: 16, beetle: 10, dragonfly: 8 };
/** Recycled once this far from the player, so the population follows them. */
const RECYCLE_RADIUS = 62;
/** Spawn ring around the player. Far enough not to pop in, near enough to find. */
const SPAWN_MIN = 11;
const SPAWN_MAX = 44;
/** Running at an insect inside this radius startles it. */
const STARTLE_RADIUS = 4.6;
/** Player speed above which an approach counts as a charge rather than a stroll. */
const STARTLE_SPEED = 5.4;
/** How often a living insect re-asks whether it still belongs where it is, in seconds. */
const RECHECK_INTERVAL = 2.5;
/** How often the ground under one is sampled. Insects drift; the island does not. */
const RESAMPLE_INTERVAL = 0.28;
/**
 * How far one may drift between checks that it is still over its own ground.
 *
 * The check costs a region lookup, which costs a heightfield sample, and doing
 * it per insect per frame is several times what the whole fish population
 * costs. Half a metre of overshoot is invisible and a fifth of the work.
 */
const BOUNDARY_CHECK_STEP_SQ = 0.5 * 0.5;

/** What the player needs to know about the world to keep the population honest. */
export interface InsectContext {
  playerX: number;
  playerZ: number;
  playerSpeed: number;
  /** The species that could be flying at a point, already filtered for time and place. */
  candidatesAt: (x: number, z: number) => SpeciesDef[];
}

function shapeOf(species: SpeciesDef): InsectShape {
  const shape = species.visual.shape;
  return shape === 'beetle' || shape === 'dragonfly' ? shape : 'butterfly';
}

/** How far back from the waterline still counts as the shore, in metres. */
const SHORE_REACH = 16;

/** Whether a point is close enough to the waterline to count as coast. */
function nearCoast(x: number, z: number): boolean {
  return Math.hypot(x, z) > coastRadius(x, z) - SHORE_REACH;
}

/**
 * Whether the ground under a point is the kind a species lives over.
 *
 * The region table already says which species belong in which named place;
 * this is the finer grain inside it, so a damselfly is over the stream rather
 * than over the middle of a dry field twenty metres from it.
 *
 * `shore` is deliberately not `sand`. The one insect that claims it is the
 * Beacon Moth, which is pinned to Lighthouse Point — a rock headland with no
 * sand on it at all. Reading shore as "the ground near the water" rather than
 * "the beach" is what puts it where its own species entry says it lives.
 */
function suitsGround(species: SpeciesDef, x: number, z: number, surface: Surface, creekDistance: number): boolean {
  switch (species.habitat) {
    case 'river':
      return creekDistance < 4.5;
    case 'beach':
      return surface === 'sand';
    case 'shore':
      return surface === 'sand' || surface === 'rock' || nearCoast(x, z);
    case 'forest':
    case 'meadow':
      return surface === 'grass' || surface === 'dirt' || surface === 'path' || surface === 'plaza';
    default:
      return true;
  }
}

export class Insects {
  readonly group = new Group();

  private insects: Insect[] = [];
  private meshes = new Map<InsectShape, { bodies: InstancedMesh; wings: InstancedMesh; slots: Insect[] }>();
  private dummy = new Object3D();
  private rng = new Rng(20614);
  private nextId = 1;
  /** Slots wait this long before trying to spawn again, so a dead area is cheap. */
  private retryTimer = 0;

  constructor() {
    this.group.name = 'Insects';

    for (const shape of ['butterfly', 'beetle', 'dragonfly'] as InsectShape[]) {
      const slots: Insect[] = [];
      for (let i = 0; i < FAMILY_SHARE[shape]; i++) {
        slots.push({
          id: this.nextId++,
          speciesId: '',
          shape,
          x: 0, y: -1000, z: 0,
          homeX: 0, homeZ: 0, groundY: 0,
          angle: 0, speed: 0, phase: this.rng.range(0, Math.PI * 2),
          state: 'drift',
          timer: 0,
          recheck: 0,
          resample: 0,
          checkX: 0,
          checkZ: 0,
          alive: false,
        });
      }
      this.insects.push(...slots);

      const material = createStylizedMaterial({ color: '#ffffff', roughness: 0.62 });
      const bodies = new InstancedMesh(insectBodyGeometry(shape), material, slots.length);
      const wings = new InstancedMesh(insectWingGeometry(shape), material, slots.length);
      bodies.name = `Insects_${shape}_bodies`;
      wings.name = `Insects_${shape}_wings`;
      bodies.frustumCulled = false;
      wings.frustumCulled = false;
      this.meshes.set(shape, { bodies, wings, slots });
      this.group.add(bodies, wings);
    }
  }

  /** Everything currently in the air. */
  get living(): Insect[] {
    return this.insects.filter((i) => i.alive);
  }

  /**
   * The insect a net swung from here would reach: the nearest one inside a
   * cone in front of the player.
   *
   * A cone rather than a circle because the swing is a gesture in a direction —
   * catching something behind your shoulder would make facing meaningless.
   */
  nearestInArc(x: number, z: number, facing: number, reach: number, halfAngle: number): Insect | null {
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const cosLimit = Math.cos(halfAngle);
    let best: Insect | null = null;
    let bestDistance = reach * reach;
    for (const insect of this.insects) {
      if (!insect.alive) continue;
      const dx = insect.x - x;
      const dz = insect.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= bestDistance) continue;
      const distance = Math.sqrt(distanceSq);
      // A swing at something right on top of you always connects; the cone
      // only starts mattering once there is a direction to be wrong about.
      if (distance > 0.4 && (dx * fx + dz * fz) / distance < cosLimit) continue;
      bestDistance = distanceSq;
      best = insect;
    }
    return best;
  }

  /** The nearest insect in plain range, for the contextual Catch prompt. */
  nearest(x: number, z: number, radius: number): Insect | null {
    let best: Insect | null = null;
    let bestDistance = radius * radius;
    for (const insect of this.insects) {
      if (!insect.alive) continue;
      const d = (insect.x - x) ** 2 + (insect.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = insect;
      }
    }
    return best;
  }

  /** Takes an insect out of the world. The slot refills somewhere else. */
  take(insect: Insect): void {
    insect.alive = false;
    insect.y = -1000;
  }

  /**
   * Sends one bolting away from a point — a missed swing, or a running player.
   *
   * The new home is only a hint: `step` refuses any move out of the species'
   * own ground, so a flee that points across a boundary simply ends with the
   * insect pressed up against it rather than over it.
   */
  startle(insect: Insect, fromX: number, fromZ: number): void {
    insect.state = 'fleeing';
    insect.timer = 2.4;
    insect.angle = Math.atan2(insect.x - fromX, insect.z - fromZ);
    // Fleeing takes them somewhere else, not in a circle back to the flower
    // they were just chased off.
    insect.homeX = insect.x + Math.sin(insect.angle) * 14;
    insect.homeZ = insect.z + Math.cos(insect.angle) * 14;
  }

  update(dt: number, time: number, context: InsectContext): void {
    this.retryTimer -= dt;
    const canSpawn = this.retryTimer <= 0;
    if (canSpawn) this.retryTimer = 0.35;
    let spawnedThisTick = 0;

    for (const insect of this.insects) {
      if (!insect.alive) {
        // A few at a time: filling thirty slots in one frame on a fresh load
        // would cost thirty region lookups in one go.
        if (canSpawn && spawnedThisTick < 4 && this.trySpawn(insect, context)) spawnedThisTick++;
        continue;
      }

      const dx = insect.x - context.playerX;
      const dz = insect.z - context.playerZ;
      const distanceSq = dx * dx + dz * dz;

      // Left behind, or no longer in season/hour — recycle the slot.
      if (distanceSq > RECYCLE_RADIUS * RECYCLE_RADIUS) {
        insect.alive = false;
        insect.y = -1000;
        continue;
      }

      this.step(insect, dt, time, context, Math.sqrt(distanceSq));
    }

    this.writeMatrices(time, context.playerX, context.playerZ);
  }

  /**
   * Whether this species may be at a point right now.
   *
   * Deliberately the caller's own catalogue filter rather than a second copy of
   * the region and time-of-day rules: two tests that are meant to agree and are
   * written twice are two tests that will one day disagree, and the disagreement
   * would be a way to net a Grove Stag Beetle on the beach at noon.
   */
  private belongsAt(context: InsectContext, insect: Insect, x: number, z: number): boolean {
    return context.candidatesAt(x, z).some((s) => s.id === insect.speciesId);
  }

  /** One insect's behaviour for the frame. */
  private step(insect: Insect, dt: number, time: number, context: InsectContext, playerDistance: number): void {
    insect.timer -= dt;

    // Dusk falls, a species goes off shift, or one has drifted somewhere it
    // does not live: retire the slot and let it come back as something that
    // does belong. Periodic rather than per-frame — this is the expensive test.
    insect.recheck -= dt;
    if (insect.recheck <= 0) {
      insect.recheck = RECHECK_INTERVAL;
      if (!this.belongsAt(context, insect, insect.x, insect.z)) {
        insect.alive = false;
        insect.y = -1000;
        return;
      }
    }

    // Walking up slowly is the whole point: only a charge scatters them.
    if (
      insect.state !== 'fleeing' &&
      playerDistance < STARTLE_RADIUS &&
      context.playerSpeed > STARTLE_SPEED
    ) {
      this.startle(insect, context.playerX, context.playerZ);
    }

    if (insect.state === 'fleeing') {
      if (insect.timer <= 0) {
        insect.state = 'drift';
        insect.timer = this.rng.range(3, 7);
      }
    } else if (insect.timer <= 0) {
      // Alternate between working a patch and resting on it. Beetles rest far
      // more than they fly, which is what makes them the easy catch.
      const restLonger = insect.shape === 'beetle';
      if (insect.state === 'settled') {
        insect.state = 'drift';
        insect.timer = this.rng.range(restLonger ? 1.4 : 3.5, restLonger ? 3.2 : 8);
      } else {
        insect.state = 'settled';
        insect.timer = this.rng.range(restLonger ? 3.5 : 1.2, restLonger ? 9 : 3.4);
      }
    }

    const settled = insect.state === 'settled';
    const fleeing = insect.state === 'fleeing';
    const speed = fleeing ? insect.speed * 3.4 : settled ? 0 : insect.speed;

    if (!settled) {
      // Wander, but lean back toward home, so a patch of flowers keeps its
      // butterflies instead of slowly emptying.
      const toHome = Math.atan2(insect.homeX - insect.x, insect.homeZ - insect.z);
      const drift = Math.hypot(insect.homeX - insect.x, insect.homeZ - insect.z) > 5 ? 0.9 : 0.12;
      let delta = toHome - insect.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      insect.angle += delta * Math.min(1, dt * drift * 3) + Math.sin(time * 1.7 + insect.phase) * dt * 1.4;

      const nx = insect.x + Math.sin(insect.angle) * speed * dt;
      const nz = insect.z + Math.cos(insect.angle) * speed * dt;
      // Turn back at the edge of the ground this species lives on, the way the
      // fish turn away from the shore. Without it a meadow butterfly wanders
      // into the pines and the net's whole geography is a suggestion.
      const strayed = (nx - insect.checkX) ** 2 + (nz - insect.checkZ) ** 2 > BOUNDARY_CHECK_STEP_SQ;
      if (!strayed || this.belongsAt(context, insect, nx, nz)) {
        insect.x = nx;
        insect.z = nz;
      } else {
        insect.angle += Math.PI * 0.6;
      }
      // Either way this is where it last knew where it stood. On a refusal that
      // stops it re-testing every frame while it is turning away from the line.
      if (strayed) {
        insect.checkX = insect.x;
        insect.checkZ = insect.z;
      }
    }

    insect.resample -= dt;
    if (insect.resample <= 0) {
      insect.resample = RESAMPLE_INTERVAL;
      insect.groundY = hoverFloor(insect.x, insect.z);
    }

    // Height: settled insects are on the thing they settled on, flying ones
    // hover, and a startled one climbs out of reach.
    const hover = settled
      ? (insect.shape === 'beetle' ? 0.12 : 0.35)
      : fleeing
        ? 2.6
        : insect.shape === 'dragonfly'
          ? 1.05
          : insect.shape === 'beetle'
            ? 0.5
            : 1.25;
    const bob = settled ? 0 : Math.sin(time * (insect.shape === 'dragonfly' ? 3.4 : 2.1) + insect.phase) * 0.16;
    const targetY = insect.groundY + hover + bob;
    insect.y += (targetY - insect.y) * Math.min(1, dt * 5.5);
  }

  /** Finds a slot somewhere plausible near the player, or leaves it empty. */
  private trySpawn(insect: Insect, context: InsectContext): boolean {
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = this.rng.range(SPAWN_MIN, SPAWN_MAX);
      const x = context.playerX + Math.cos(angle) * radius;
      const z = context.playerZ + Math.sin(angle) * radius;

      const ground = sampleSurface(x, z);
      if (ground.height <= SEA_LEVEL + 0.2 || ground.slope > 0.55) continue;
      if (!isWalkable(x, z)) continue;

      const creekDistance = distanceToCreek(x, z);
      const overWater = creekDepth(x, z) > 0.05;
      const candidates = context
        .candidatesAt(x, z)
        .filter((s) => {
          if (shapeOf(s) !== insect.shape) return false;
          // Standing water is the damselfly's whole address and no use at all
          // to a butterfly. It is also the only ground the region table lets a
          // river species stand on: the dry bank a few metres away is not in
          // the creek's region, so refusing the water outright meant the
          // dragonflies had nowhere in the world they were allowed to be.
          if (overWater !== (s.habitat === 'river')) return false;
          return suitsGround(s, x, z, ground.surface, creekDistance);
        });
      if (candidates.length === 0) continue;

      const species = this.weightedPick(candidates);
      insect.speciesId = species.id;
      insect.x = x;
      insect.z = z;
      insect.homeX = x;
      insect.homeZ = z;
      insect.groundY = hoverFloor(x, z);
      insect.y = insect.groundY + 1;
      insect.angle = this.rng.range(0, Math.PI * 2);
      insect.speed = insect.shape === 'dragonfly'
        ? this.rng.range(1.3, 2.4)
        : insect.shape === 'beetle'
          ? this.rng.range(0.25, 0.6)
          : this.rng.range(0.7, 1.35);
      insect.phase = this.rng.range(0, Math.PI * 2);
      insect.state = 'drift';
      insect.timer = this.rng.range(1.5, 5);
      // Staggered, so the whole population never re-checks on the same frame.
      insect.recheck = this.rng.range(0.5, RECHECK_INTERVAL);
      insect.resample = this.rng.range(0, RESAMPLE_INTERVAL);
      insect.checkX = x;
      insect.checkZ = z;
      insect.alive = true;

      const family = this.meshes.get(insect.shape);
      if (family) {
        const index = family.slots.indexOf(insect);
        if (index >= 0) {
          family.bodies.setColorAt(index, scratchColor.set(species.visual.accent ?? species.visual.primary));
          family.wings.setColorAt(index, scratchColor.set(species.visual.primary));
          if (family.bodies.instanceColor) family.bodies.instanceColor.needsUpdate = true;
          if (family.wings.instanceColor) family.wings.instanceColor.needsUpdate = true;
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Rarity thins the air, so the rare ones are a sighting rather than a chore.
   *
   * Species pinned to a single region get that thinning eased, because their
   * scarcity is already expressed by *where* they are. Under the old dice roll
   * you could stand in the grove and keep swinging until the Grove Stag Beetle
   * came up; now you have to find one, and stacking table rarity on top of
   * geographic rarity would mean a region's signature insect was usually simply
   * not there.
   */
  private weightedPick(candidates: SpeciesDef[]): SpeciesDef {
    const weights = candidates.map((c) => {
      const base = c.rarity === 'common' ? 100 : c.rarity === 'uncommon' ? 34 : c.rarity === 'rare' ? 9 : 3;
      return c.region ? base * 3 : base;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng.range(0, total);
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  private writeMatrices(time: number, playerX: number, playerZ: number): void {
    for (const { bodies, wings, slots } of this.meshes.values()) {
      for (let i = 0; i < slots.length; i++) {
        const insect = slots[i];
        const distanceSq = (insect.x - playerX) ** 2 + (insect.z - playerZ) ** 2;
        if (!insect.alive || distanceSq > 52 * 52) {
          this.dummy.position.set(0, -1000, 0);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.setScalar(0.001);
          this.dummy.updateMatrix();
          bodies.setMatrixAt(i, this.dummy.matrix);
          wings.setMatrixAt(i, this.dummy.matrix);
          continue;
        }

        // A settled insect folds its wings; a flying one beats them. The beat
        // is fast enough to blur, which is why the wings are one mesh scaled
        // on X rather than two hinged ones.
        const beatRate = insect.shape === 'dragonfly' ? 34 : insect.shape === 'beetle' ? 26 : 13;
        const beat = insect.state === 'settled'
          ? 0.12
          : 0.25 + Math.abs(Math.sin(time * beatRate + insect.phase)) * 0.75;

        this.dummy.position.set(insect.x, insect.y, insect.z);
        this.dummy.rotation.set(0, insect.angle, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        bodies.setMatrixAt(i, this.dummy.matrix);

        this.dummy.scale.set(beat, 1, 1);
        this.dummy.updateMatrix();
        wings.setMatrixAt(i, this.dummy.matrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      wings.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const { bodies, wings } of this.meshes.values()) {
      bodies.geometry.dispose();
      wings.geometry.dispose();
      (bodies.material as Material).dispose();
      bodies.dispose();
      wings.dispose();
    }
  }
}

const scratchColor = new Color();

/**
 * Bodies, matching the silhouettes {@link import('@/items/ItemModels')} draws
 * for the same species so a butterfly in the air and the same butterfly in the
 * bag are the same creature.
 */
function insectBodyGeometry(shape: InsectShape): BufferGeometry {
  if (shape === 'beetle') {
    const shell = new SphereGeometry(0.075, 8, 6);
    shell.scale(0.85, 0.62, 1.15);
    const head = new SphereGeometry(0.035, 6, 5);
    head.translate(0, 0.006, 0.085);
    return mergeGeometries([shell, head]);
  }
  if (shape === 'dragonfly') {
    const abdomen = new CylinderGeometry(0.011, 0.005, 0.26, 5);
    abdomen.rotateX(Math.PI / 2);
    abdomen.translate(0, 0, -0.08);
    const thorax = new SphereGeometry(0.026, 6, 5);
    thorax.translate(0, 0, 0.05);
    const head = new SphereGeometry(0.024, 6, 5);
    head.translate(0, 0, 0.095);
    return mergeGeometries([abdomen, thorax, head]);
  }
  const body = new CylinderGeometry(0.016, 0.011, 0.12, 5);
  body.rotateX(Math.PI / 2);
  const head = new SphereGeometry(0.019, 6, 5);
  head.translate(0, 0, 0.065);
  return mergeGeometries([body, head]);
}

/** Wings, as one mesh per insect. The caller scales it on X to beat them. */
function insectWingGeometry(shape: InsectShape): BufferGeometry {
  const parts: BufferGeometry[] = [];

  if (shape === 'beetle') {
    // Elytra: a split shell rather than a flapping pair, which is what a
    // beetle actually shows unless it is taking off.
    for (const side of [-1, 1]) {
      const wing = new SphereGeometry(0.062, 7, 5);
      wing.scale(0.5, 0.3, 1);
      wing.translate(side * 0.036, 0.05, -0.01);
      parts.push(wing);
    }
  } else if (shape === 'dragonfly') {
    for (const side of [-1, 1]) {
      for (const offset of [0.035, -0.03]) {
        const wing = new SphereGeometry(0.12, 7, 4);
        wing.scale(1, 0.03, 0.22);
        wing.translate(side * 0.12, 0.02, offset);
        parts.push(wing);
      }
    }
  } else {
    for (const side of [-1, 1]) {
      const upper = new ConeGeometry(0.075, 0.14, 5);
      upper.rotateZ(side * Math.PI / 2);
      upper.scale(1, 1, 0.75);
      upper.translate(side * 0.075, 0.015, 0.02);
      parts.push(upper);
      const lower = new ConeGeometry(0.052, 0.1, 5);
      lower.rotateZ(side * Math.PI / 2);
      lower.scale(1, 1, 0.8);
      lower.translate(side * 0.055, 0, -0.05);
      parts.push(lower);
    }
  }

  return mergeGeometries(parts);
}
