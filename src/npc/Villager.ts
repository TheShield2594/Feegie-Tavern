import { Group, Vector3 } from 'three';
import { CharacterAnimator } from '@/player/CharacterAnimator';
import { CharacterRig } from '@/player/CharacterRig';
import { dampAngle, lerp } from '@/util/math';
import { LANDMARKS, terrainHeight } from '@/world/heightfield';
import type { ScheduleEntry, VillagerDef } from '@/data/villagers';
import type { Navigation, NavPoint } from './Navigation';

export type VillagerActivity = ScheduleEntry['activity'];

const WALK_SPEED = 2.5;
const ARRIVE_RADIUS = 0.9;
/** How far a villager wanders around its anchor while idling. */
const WANDER_RADIUS = 3.4;

/**
 * A single neighbour: model, animation, schedule and pathfinding.
 *
 * Movement always goes through the navigation grid, so villagers use the paths
 * and never walk through a wall — the behaviour the prototype's lerp-to-target
 * could not give.
 */
export class Villager {
  readonly group = new Group();
  readonly rig: CharacterRig;
  readonly animator: CharacterAnimator;

  readonly position = new Vector3();
  facing = 0;

  activity: VillagerActivity = 'idle';
  scheduleLabel = '';
  /** Where the schedule currently wants them. */
  private anchor = new Vector3();
  private path: NavPoint[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private wanderTimer = 0;
  private activityTimer = 0;

  /** Set while the player is talking to them. */
  talking = false;
  private lastEntryIndex = -1;

  /** Villagers with an unmet request show a marker. */
  hasRequest = false;

  constructor(
    readonly def: VillagerDef,
    private nav: Navigation,
  ) {
    this.rig = new CharacterRig({ height: 1.5, villager: def.look });
    this.animator = new CharacterAnimator(this.rig);
    this.group.add(this.rig.group);
    this.group.name = `Villager_${def.id}`;

    const home = LANDMARKS[def.homeAnchor] ?? LANDMARKS['square.center'];
    this.position.set(home.x, terrainHeight(home.x, home.z), home.z);
    this.anchor.copy(this.position);
    this.group.position.copy(this.position);
  }

  /** Chooses the schedule entry in force at this hour. */
  private entryFor(hour: number): { entry: ScheduleEntry; index: number } {
    const schedule = this.def.schedule;
    let chosen = schedule[0];
    let index = 0;
    for (let i = 0; i < schedule.length; i++) {
      if (hour >= schedule[i].from) {
        chosen = schedule[i];
        index = i;
      }
    }
    return { entry: chosen, index };
  }

  /** Re-evaluates the schedule; call on the hour or after a warp. */
  applySchedule(hour: number, force = false): void {
    const { entry, index } = this.entryFor(hour);
    if (index === this.lastEntryIndex && !force) return;
    this.lastEntryIndex = index;
    this.scheduleLabel = entry.label;
    this.activity = entry.activity;

    const target = LANDMARKS[entry.at] ?? LANDMARKS['square.center'];
    this.anchor.set(target.x, terrainHeight(target.x, target.z), target.z);
    this.repath();
  }

  private repath(): void {
    if (this.talking) return;
    this.path = this.nav.findPath(this.position.x, this.position.z, this.anchor.x, this.anchor.z);
    this.pathIndex = 0;
    this.repathTimer = 0;
  }

  /** Sends the villager to an arbitrary point — festivals, reactions, events. */
  goTo(x: number, z: number, activity: VillagerActivity = 'idle'): void {
    this.anchor.set(x, terrainHeight(x, z), z);
    this.activity = activity;
    this.repath();
  }

  startTalking(playerX: number, playerZ: number): void {
    this.talking = true;
    this.path = [];
    this.facing = Math.atan2(playerX - this.position.x, playerZ - this.position.z);
    this.animator.play('talk');
    this.rig.setExpression('happy');
  }

  stopTalking(): void {
    this.talking = false;
    this.rig.setExpression('neutral');
    this.repath();
  }

  /** Plays a one-off reaction, e.g. when the player donates or gives a gift. */
  react(kind: 'happy' | 'surprised' | 'celebrate'): void {
    if (kind === 'celebrate') this.animator.play('celebrate', { force: true });
    this.rig.setExpression(kind === 'celebrate' ? 'excited' : kind);
  }

  update(dt: number, hour: number, playerPosition: Vector3): void {
    this.repathTimer -= dt;

    if (!this.talking) {
      if (this.path.length > 0) {
        this.followPath(dt);
      } else {
        this.performActivity(dt, hour);
      }
    }

    // Ground and orient.
    this.position.y = lerp(this.position.y, terrainHeight(this.position.x, this.position.z), 1 - Math.exp(-14 * dt));
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    // Villagers glance at the player when they are close, which does more for
    // "inhabited" than any amount of extra walking.
    const distanceSq = playerPosition.distanceToSquared(this.position);
    if (distanceSq < 64) {
      this.rig.lookAt(playerPosition.x, playerPosition.z, this.position.x, this.position.z, this.facing);
      if (!this.talking && this.path.length === 0 && distanceSq < 16) {
        this.facing = dampAngle(
          this.facing,
          Math.atan2(playerPosition.x - this.position.x, playerPosition.z - this.position.z),
          0.4,
          dt,
        );
      }
    }

    this.animator.update(dt);
  }

  private followPath(dt: number): void {
    const target = this.path[this.pathIndex];
    if (!target) {
      this.path = [];
      return;
    }

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE_RADIUS) {
      this.pathIndex += 1;
      if (this.pathIndex >= this.path.length) {
        this.path = [];
        this.activityTimer = 0;
      }
      return;
    }

    // Ease speed down on the final approach so arrivals do not snap.
    const remaining = this.path.length - this.pathIndex;
    const speed = WALK_SPEED * (remaining === 1 ? Math.min(1, distance / 2.2) : 1);
    this.position.x += (dx / distance) * speed * dt;
    this.position.z += (dz / distance) * speed * dt;
    this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 0.1, dt);

    this.animator.play('walk');
    this.animator.intensity = 0.8;
    this.animator.speed = speed / WALK_SPEED;
  }

  private performActivity(dt: number, hour: number): void {
    this.activityTimer += dt;

    switch (this.activity) {
      case 'sleep':
        this.animator.play('sleep');
        this.rig.setExpression('sleepy');
        break;

      case 'sit':
        this.animator.play('sit');
        break;

      case 'fish':
        // Alternate casting and waiting so the pier looks worked, not posed.
        if (this.animator.currentClip !== 'fishCast' && this.activityTimer > 9) {
          this.animator.play('fishCast', { force: true });
          this.activityTimer = 0;
        } else if (!this.animator.isBusy) {
          this.animator.play('fishWait');
        }
        break;

      case 'tend':
        if (!this.animator.isBusy && this.activityTimer > 3.5) {
          this.animator.play(Math.random() < 0.5 ? 'plant' : 'pick', { force: true });
          this.activityTimer = 0;
        }
        break;

      case 'browse':
      case 'talk':
        this.animator.play('talk');
        break;

      case 'walk':
        // Wander in a small circle around the anchor.
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.wanderTimer = 4 + Math.random() * 5;
          const angle = Math.random() * Math.PI * 2;
          const radius = WANDER_RADIUS * (0.5 + Math.random() * 0.5);
          const wx = this.anchor.x + Math.cos(angle) * radius;
          const wz = this.anchor.z + Math.sin(angle) * radius;
          if (!this.nav.isBlocked(wx, wz)) {
            this.path = this.nav.findPath(this.position.x, this.position.z, wx, wz);
            this.pathIndex = 0;
          }
        }
        this.animator.play('idle');
        break;

      case 'idle':
      default:
        this.animator.play(hour >= 22 || hour < 6 ? 'idleTired' : 'idle');
        // Drift back if they have been nudged off their spot.
        if (this.repathTimer <= 0) {
          this.repathTimer = 3;
          if (this.position.distanceToSquared(this.anchor) > 9) this.repath();
        }
        break;
    }
  }

  get isMoving(): boolean {
    return this.path.length > 0;
  }

  dispose(): void {
    this.rig.dispose();
  }
}
