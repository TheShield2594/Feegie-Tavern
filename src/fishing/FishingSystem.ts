import {
  CylinderGeometry,
  Group,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Mesh,
  QuadraticBezierCurve3,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '@/core/EventBus';
import { createStylizedMaterial } from '@/rendering/materials';
import { FISH, SEA_CREATURES } from '@/data/species';
import type { SpeciesDef } from '@/items/types';
import { clamp, clamp01, lerp } from '@/util/math';
import type { ParticleSystem } from '@/rendering/Particles';
import type { Player } from '@/player/Player';
import { SEA_LEVEL, anyWaterDepth, creekDepth, creekSurfaceHeight, waterDepth } from '@/world/heightfield';
import { regionAt, type RegionId } from '@/world/regions';
import type { FishSchools } from './FishSchools';
import type { Season } from '@/time/TimeSystem';

export type FishingState =
  | 'idle'
  | 'casting'
  | 'waiting'
  | 'investigating'
  | 'nibbling'
  | 'biting'
  | 'reeling'
  | 'landing'
  | 'escaped';

export interface FishingResult {
  species: SpeciesDef;
  sizeCm: number;
}

const CAST_FLIGHT_TIME = 0.62;
/** How long the player has to react once the fish takes the lure. */
const BITE_WINDOW = 0.95;

/**
 * The fishing loop.
 *
 * Every beat the brief asks for is a state here: the cast arc, the splash, a
 * fish coming to look, nibbles that are not yet a bite, the bite itself, a reel
 * with real tension, and the catch. The system owns the bobber, the line and
 * the tension model; the UI only reads `state` and `tension`.
 */
export class FishingSystem {
  readonly group = new Group();

  state: FishingState = 'idle';
  /** 0–1 line tension. Losing at either end loses the fish. */
  tension = 0.4;
  /** 0–1 progress toward landing the fish. */
  progress = 0;
  /** The species on the line, once one has committed. */
  hooked: SpeciesDef | null = null;
  hookedSize = 0;

  private bobber: Group;
  private ripple: Mesh;
  private line: Line;
  private lineGeometry = new BufferGeometry();

  private castStart = new Vector3();
  private castTarget = new Vector3();
  private bobberPosition = new Vector3();
  /**
   * The water under the bobber. The creek stands metres above sea level, so
   * every bob, dip and ripple is measured from here rather than from SEA_LEVEL.
   */
  private waterLevel = SEA_LEVEL;
  /** Whether the lure is in the creek. Fresh and salt draw from separate pools. */
  private freshwater = false;
  /** Region the lure landed in, for species that live in exactly one place. */
  private waterRegion: RegionId = 'sea';
  private stateTimer = 0;
  private nibbleCount = 0;
  private struggle = 0;
  private struggleTimer = 0;

  constructor(
    private bus: EventBus,
    private particles: ParticleSystem,
    private schools: FishSchools,
  ) {
    this.group.name = 'Fishing';

    this.bobber = new Group();
    const float = new Mesh(
      new SphereGeometry(0.11, 12, 10),
      createStylizedMaterial({ color: '#f6f2e6', roughness: 0.5 }),
    );
    const cap = new Mesh(
      new SphereGeometry(0.115, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      createStylizedMaterial({ color: '#e0574f', roughness: 0.45 }),
    );
    cap.position.y = 0.01;
    const stem = new Mesh(
      new CylinderGeometry(0.014, 0.014, 0.16, 6),
      createStylizedMaterial({ color: '#3a3a42', roughness: 0.4, metalness: 0.4 }),
    );
    stem.position.y = 0.16;
    this.bobber.add(float, cap, stem);
    this.bobber.visible = false;
    this.group.add(this.bobber);

    this.ripple = new Mesh(
      new TorusGeometry(0.4, 0.03, 5, 24),
      createStylizedMaterial({ color: '#eaf7fc', roughness: 0.4, transparent: true, opacity: 0.6 }),
    );
    this.ripple.rotation.x = -Math.PI / 2;
    this.ripple.visible = false;
    this.group.add(this.ripple);

    const lineMaterial = new LineBasicMaterial({ color: 0xf0f4f2, transparent: true, opacity: 0.55 });
    this.line = new Line(this.lineGeometry, lineMaterial);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  get bobberWorldPosition(): Vector3 {
    return this.bobberPosition;
  }

  /** Attempts a cast. Returns false when there is no fishable water ahead. */
  cast(player: Player, rodLevel: number): boolean {
    if (this.state !== 'idle') return false;

    // Find the furthest reachable water within the rod's range. The creek
    // counts: it is the only fresh water on the island and half the catalogue
    // lives in it.
    const maxRange = 6 + rodLevel * 1.6;
    let target: Vector3 | null = null;
    for (let distance = maxRange; distance >= 2.5; distance -= 0.5) {
      const x = player.position.x + player.forwardX * distance;
      const z = player.position.z + player.forwardZ * distance;
      if (anyWaterDepth(x, z) <= 0.55) continue;
      this.freshwater = creekDepth(x, z) > waterDepth(x, z);
      this.waterLevel = this.freshwater ? creekSurfaceHeight(x, z) : SEA_LEVEL;
      // Salt water is one region as far as fishing is concerned; a named
      // region's circle can reach past the waterline, and a cast off the
      // orchard's shore should still be a cast into the cove.
      this.waterRegion = this.freshwater ? regionAt(x, z) : 'sea';
      target = new Vector3(x, this.waterLevel, z);
      break;
    }
    if (!target) return false;

    this.castStart.copy(player.position).setY(player.position.y + 1.35);
    this.castTarget.copy(target);
    this.bobberPosition.copy(this.castStart);
    this.state = 'casting';
    this.stateTimer = 0;
    this.tension = 0.4;
    this.progress = 0;
    this.hooked = null;
    this.nibbleCount = 0;

    this.bobber.visible = true;
    this.line.visible = true;
    player.beginFishing();
    this.bus.emit('audio:sfx', { id: 'tool.cast' });
    this.bus.emit('fishing:state', { state: this.state });
    return true;
  }

  /** Called when the player presses the action button. */
  strike(player: Player): void {
    switch (this.state) {
      case 'biting':
        // Hooked it. Move to the reel.
        this.state = 'reeling';
        this.stateTimer = 0;
        this.tension = 0.45;
        this.progress = 0;
        this.struggle = 0;
        this.struggleTimer = 0.4;
        player.setFishingPose('reel');
        this.bus.emit('audio:sfx', { id: 'tool.reel' });
        this.bus.emit('fishing:state', { state: this.state });
        break;

      case 'waiting':
      case 'investigating':
      case 'nibbling':
        // Struck too early — the fish scatters.
        this.miss(player, 'Too early. It scattered.');
        break;

      default:
        break;
    }
  }

  /** Cancels an active cast. */
  reelIn(player: Player, message = 'Reeled in.'): void {
    if (this.state === 'idle') return;
    this.finish(player);
    this.bus.emit('ui:toast', { text: message, tone: 'neutral' });
  }

  private miss(player: Player, message: string): void {
    this.state = 'escaped';
    this.stateTimer = 0;
    this.schools.releaseLure();
    this.particles.burst('splash', this.bobberPosition, 0.6);
    this.bus.emit('audio:sfx', { id: 'tool.splash', volume: 0.6 });
    this.bus.emit('ui:toast', { text: message, tone: 'warn' });
    this.bus.emit('fishing:state', { state: this.state });
    player.rig.setExpression('sad');
  }

  private finish(player: Player): void {
    this.state = 'idle';
    this.hooked = null;
    this.bobber.visible = false;
    this.ripple.visible = false;
    this.line.visible = false;
    this.schools.releaseLure();
    player.endFishing();
    this.bus.emit('fishing:state', { state: 'idle' });
  }

  /**
   * @param holding Whether the action button is currently held (reeling in).
   * @returns The catch, on the frame it is landed.
   */
  update(
    dt: number,
    player: Player,
    holding: boolean,
    context: { hour: number; season: Season; rodLevel: number },
  ): FishingResult | null {
    if (this.state === 'idle') return null;
    this.stateTimer += dt;

    switch (this.state) {
      case 'casting': {
        const t = clamp01(this.stateTimer / CAST_FLIGHT_TIME);
        // A real arc, not a lerp — the bobber should visibly fly.
        const peak = this.castStart.clone().lerp(this.castTarget, 0.5);
        peak.y += 3.4;
        const curve = new QuadraticBezierCurve3(this.castStart, peak, this.castTarget);
        curve.getPoint(t, this.bobberPosition);

        if (t >= 1) {
          this.bobberPosition.copy(this.castTarget);
          this.state = 'waiting';
          this.stateTimer = 0;
          this.particles.burst('splash', this.bobberPosition, 0.8);
          this.particles.burst('waterRing', this.bobberPosition, 1);
          this.ripple.visible = true;
          this.ripple.scale.setScalar(0.4);
          this.ripple.position.copy(this.bobberPosition).setY(this.waterLevel + 0.03);
          this.bus.emit('audio:sfx', { id: 'tool.splash' });
          player.setFishingPose('wait');
          this.bus.emit('fishing:state', { state: this.state });
        }
        break;
      }

      case 'waiting': {
        this.bobberPosition.y = this.waterLevel + Math.sin(this.stateTimer * 2.2) * 0.04;
        // A better rod draws attention faster.
        const attractDelay = lerp(3.4, 1.4, (context.rodLevel - 1) / 2);
        if (this.stateTimer > attractDelay) {
          const approach = this.schools.attractTo(this.bobberPosition, 11, this.freshwater);
          this.state = 'investigating';
          this.stateTimer = 0;
          this.bus.emit('fishing:state', { state: this.state });
          if (!approach) {
            // Nothing nearby: give it a moment, then let the player know.
            this.state = 'waiting';
            this.stateTimer = -2.5;
          }
        }
        break;
      }

      case 'investigating': {
        this.bobberPosition.y = this.waterLevel + Math.sin(this.stateTimer * 2.6) * 0.05;
        const fish = this.schools.luredPosition();
        if (fish) {
          const distance = Math.hypot(fish.x - this.bobberPosition.x, fish.z - this.bobberPosition.z);
          if (distance < 1.4) {
            this.state = 'nibbling';
            this.stateTimer = 0;
            this.nibbleCount = 1 + Math.floor(Math.random() * 3);
            this.bus.emit('fishing:state', { state: this.state });
          }
        }
        if (this.stateTimer > 9) {
          // It lost interest; try again.
          this.schools.releaseLure();
          this.state = 'waiting';
          this.stateTimer = 0;
        }
        break;
      }

      case 'nibbling': {
        // Small dips of the bobber: the tell that separates a bite from a tease.
        const dip = Math.max(0, Math.sin(this.stateTimer * 9)) * 0.16;
        this.bobberPosition.y = this.waterLevel - dip;
        if (dip > 0.14 && Math.random() < 0.25) {
          this.particles.burst('waterRing', this.bobberPosition, 0.35);
          this.bus.emit('audio:sfx', { id: 'tool.reel', volume: 0.4 });
        }
        const perNibble = 0.9;
        if (this.stateTimer > this.nibbleCount * perNibble) {
          this.hooked = this.pickSpecies(context);
          this.hookedSize = rollSpeciesSize(this.hooked);
          this.state = 'biting';
          this.stateTimer = 0;
          this.particles.burst('splash', this.bobberPosition, 0.7);
          this.bus.emit('audio:sfx', { id: 'tool.bite' });
          this.bus.emit('fishing:state', { state: this.state });
          player.rig.setExpression('surprised');
        }
        break;
      }

      case 'biting': {
        this.bobberPosition.y = this.waterLevel - 0.24 - Math.sin(this.stateTimer * 22) * 0.06;
        if (this.stateTimer > BITE_WINDOW) {
          this.miss(player, 'It slipped the hook.');
        }
        break;
      }

      case 'reeling': {
        const species = this.hooked!;
        const fight = rarityFight(species) * (0.85 + (this.hookedSize / Math.max(1, species.sizeCm ?? 30)) * 0.3);

        // The fish surges at intervals; holding through a surge over-tensions.
        this.struggleTimer -= dt;
        if (this.struggleTimer <= 0) {
          this.struggle = this.struggle > 0.5 ? 0 : 1;
          this.struggleTimer = this.struggle > 0.5
            ? lerp(0.5, 1.1, Math.random())
            : lerp(0.7, 1.5, Math.random());
        }

        const pull = holding ? 1 : -1;
        const fishPull = this.struggle > 0.5 ? fight : fight * 0.28;
        this.tension = clamp(this.tension + (pull * 0.85 + fishPull * 0.75 - 0.55) * dt, 0, 1.15);

        // Progress only accrues while reeling inside the safe band.
        const inBand = this.tension > 0.22 && this.tension < 0.9;
        if (holding && inBand) {
          this.progress = clamp01(this.progress + dt * (0.34 + context.rodLevel * 0.07) / fight);
          this.bus.emit('audio:sfx', { id: 'tool.reel', volume: 0.35 });
        } else if (!holding) {
          this.progress = Math.max(0, this.progress - dt * 0.1);
        }

        // Draw the bobber in as the fish tires.
        const toPlayer = new Vector3(player.position.x, this.waterLevel, player.position.z);
        this.bobberPosition.lerp(toPlayer, this.progress * dt * 1.6);
        this.bobberPosition.y = this.waterLevel - 0.16 - Math.sin(this.stateTimer * 14) * 0.05 * this.struggle;

        if (Math.random() < dt * 6 * this.struggle) {
          this.particles.burst('waterRing', this.bobberPosition, 0.3);
        }

        if (this.tension >= 1.12) {
          this.miss(player, `The line snapped. ${species.name} is gone.`);
          return null;
        }
        if (this.tension <= 0.01) {
          this.miss(player, 'The line went slack and it shook free.');
          return null;
        }
        if (this.progress >= 1) {
          this.state = 'landing';
          this.stateTimer = 0;
          this.particles.burst('splash', this.bobberPosition, 1.4);
          this.particles.burst('sparkle', this.bobberPosition, species.rarity === 'common' ? 0.6 : 1.6);
          this.bus.emit('audio:sfx', { id: 'tool.splash' });
          this.bus.emit('fishing:state', { state: this.state });
        }
        break;
      }

      case 'landing': {
        if (this.stateTimer > 0.4) {
          const result: FishingResult = { species: this.hooked!, sizeCm: this.hookedSize };
          this.finish(player);
          player.celebrate();
          return result;
        }
        break;
      }

      case 'escaped': {
        if (this.stateTimer > 0.8) this.finish(player);
        break;
      }
    }

    this.updateVisuals(dt, player);
    return null;
  }

  private updateVisuals(dt: number, player: Player): void {
    this.bobber.position.copy(this.bobberPosition);
    // Tilt the bobber when something is pulling on it.
    const tilt = this.state === 'reeling' || this.state === 'biting' ? 0.5 : 0.05;
    this.bobber.rotation.z = Math.sin(this.stateTimer * 9) * tilt;

    if (this.ripple.visible) {
      this.ripple.position.set(this.bobberPosition.x, this.waterLevel + 0.03, this.bobberPosition.z);
      const grow = this.state === 'reeling' ? 3.5 : 1.2;
      this.ripple.scale.x += dt * grow;
      this.ripple.scale.y += dt * grow;
      const material = this.ripple.material as { opacity: number };
      material.opacity = Math.max(0, 0.6 - (this.ripple.scale.x - 0.4) * 0.35);
      if (this.ripple.scale.x > 2.6) {
        this.ripple.scale.set(0.4, 0.4, 1);
        material.opacity = 0.6;
      }
    }

    // The line sags between rod tip and bobber, more when there is no tension.
    const tip = player.rig.toolAnchor.getWorldPosition(new Vector3());
    tip.y += 1.4;
    const sag = this.state === 'reeling' ? lerp(0.7, 0.02, this.tension) : 0.45;
    const mid = tip.clone().lerp(this.bobberPosition, 0.5);
    mid.y -= sag;
    const curve = new QuadraticBezierCurve3(tip, mid, this.bobberPosition);
    this.lineGeometry.setFromPoints(curve.getPoints(14));
  }

  /** Weighted pick from what is actually biting at this hour and season. */
  private pickSpecies(context: { hour: number; season: Season; rodLevel: number }): SpeciesDef {
    const pool = this.freshwater ? FRESHWATER : SALTWATER;

    // Depth only sorts the sea. The creek is shallow everywhere, and grading it
    // by depth would have put the whole shelf's worth of species into it.
    const depth = waterDepth(this.bobberPosition.x, this.bobberPosition.z);
    const habitat = depth > 4.5 ? 'deep' : 'shallow';

    const weights: number[] = [];

    for (const species of pool) {
      // A species that lives in one region lives nowhere else — that is the
      // whole point of walking out to it.
      if (species.region && species.region !== this.waterRegion) {
        weights.push(0);
        continue;
      }

      let weight = rarityWeight(species.rarity);

      // Habitat: species out of their water are rare, not impossible. Fresh and
      // salt never mix, because the pools above already kept them apart.
      if (!this.freshwater && species.habitat && species.habitat !== habitat) {
        const compatible = habitat === 'deep'
          ? species.habitat === 'reef' || species.habitat === 'shallow'
          : species.habitat === 'reef';
        weight *= compatible ? 0.45 : 0.12;
      }

      // Time of day, honouring windows that wrap past midnight.
      if (species.activeHours) {
        const [from, to] = species.activeHours;
        const active = from <= to
          ? context.hour >= from && context.hour < to
          : context.hour >= from || context.hour < to;
        weight *= active ? 1.5 : 0.08;
      }

      if (species.seasons && species.seasons.length > 0 && !species.seasons.includes(context.season)) {
        weight *= 0.05;
      }

      // A better rod tilts the odds toward the rare end.
      if (species.rarity === 'rare' || species.rarity === 'legendary') {
        weight *= 1 + (context.rodLevel - 1) * 0.55;
      }

      weights.push(Math.max(0.001, weight));
    }

    let total = 0;
    for (const w of weights) total += w;
    // Everything eligible was region-locked out — only reachable if a pool is
    // ever reduced to locked species. Fall back to the first thing that is not.
    if (total <= 0) return pool.find((s) => !s.region) ?? pool[0];
    let pick = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return pool[i];
    }
    return pool[0];
  }

  dispose(): void {
    this.lineGeometry.dispose();
  }
}

/**
 * The two catalogues, split once at module load.
 *
 * Keeping them apart here rather than weighting a single pool is what makes
 * "river species distinct from the sea" true rather than merely unlikely: a
 * Bluegill cannot be pulled out of the cove at any odds, and a Velvet Ray
 * cannot be pulled out of the creek.
 */
const FRESHWATER: SpeciesDef[] = FISH.filter((s) => s.habitat === 'river');
const SALTWATER: SpeciesDef[] = [
  ...FISH.filter((s) => s.habitat !== 'river'),
  ...SEA_CREATURES.filter((s) => s.habitat === 'deep' || s.habitat === 'reef'),
];

function rarityWeight(rarity: SpeciesDef['rarity']): number {
  switch (rarity) {
    case 'common': return 100;
    case 'uncommon': return 42;
    case 'rare': return 11;
    case 'legendary': return 1.6;
    default: return 20;
  }
}

/** How hard a species fights, as a reel difficulty multiplier. */
function rarityFight(species: SpeciesDef): number {
  const base = species.rarity === 'legendary' ? 1.9 : species.rarity === 'rare' ? 1.5 : species.rarity === 'uncommon' ? 1.2 : 1;
  const size = species.sizeCm ?? 30;
  return base * (0.85 + clamp01(size / 140) * 0.6);
}

function rollSpeciesSize(species: SpeciesDef): number {
  if (species.sizeCm === undefined) return 0;
  const variance = species.sizeVarianceCm ?? species.sizeCm * 0.25;
  const roll = (Math.random() + Math.random()) / 2;
  return Math.round((species.sizeCm + (roll * 2 - 1) * variance) * 10) / 10;
}
