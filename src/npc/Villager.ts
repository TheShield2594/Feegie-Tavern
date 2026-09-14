import { Group, Vector3 } from 'three';
import { CharacterAnimator } from '@/player/CharacterAnimator';
import { CharacterRig } from '@/player/CharacterRig';
import { dampAngle, lerp } from '@/util/math';
import { EmoteBubble, Nameplate } from '@/rendering/WorldLabel';
import { LANDMARKS, terrainHeight, walkHeight } from '@/world/heightfield';
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
  /** Personal offset from a shared schedule anchor. */
  readonly anchorOffset: { x: number; z: number };
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
  /** Another villager this one is chatting with, set by the manager. */
  chattingWith: Villager | null = null;
  private chatTimer = 0;
  private glanceTimer = 3;
  private glanceYaw = 0;

  readonly nameplate: Nameplate;
  readonly bubble = new EmoteBubble();
  /** Seconds until a queued reaction (a wave back) plays. */
  private reactionTimer = 0;
  private queuedReaction: 'wave' | 'nod' | null = null;
  private greetCooldown = 0;

  constructor(
    readonly def: VillagerDef,
    private nav: Navigation,
  ) {
    this.rig = new CharacterRig({ height: 1.5, villager: def.look });
    this.animator = new CharacterAnimator(this.rig);
    this.group.add(this.rig.group);
    this.group.name = `Villager_${def.id}`;

    this.nameplate = new Nameplate({ text: def.name, accent: def.look.outfit });
    this.nameplate.sprite.position.y = this.rig.height * def.look.height + 0.55;
    this.group.add(this.nameplate.sprite);
    this.bubble.baseY = this.rig.height * def.look.height + 1.05;
    this.group.add(this.bubble.sprite);

    // Each villager stands a little off the shared anchor, at their own angle,
    // so two neighbours sent to the square do not occupy the same spot.
    const seed = [...def.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    this.anchorOffset = { x: Math.cos(seed * 1.7) * 1.7, z: Math.sin(seed * 1.7) * 1.7 };

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
    const x = target.x + this.anchorOffset.x;
    const z = target.z + this.anchorOffset.z;
    this.anchor.set(x, terrainHeight(x, z), z);
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
    if (kind === 'celebrate') {
      this.animator.play('celebrate', { force: true });
      this.bubble.show('heart', 1.6);
    }
    this.rig.setExpression(kind === 'celebrate' ? 'excited' : kind);
  }

  /**
   * The player waved nearby. Villagers answer after a beat — the delay is what
   * makes it read as a response rather than a mirror.
   */
  greetBack(): void {
    if (this.talking || this.activity === 'sleep' || this.greetCooldown > 0) return;
    this.queuedReaction = Math.random() < 0.75 ? 'wave' : 'nod';
    this.reactionTimer = 0.35 + Math.random() * 0.4;
    this.greetCooldown = 6;
  }

  update(dt: number, hour: number, playerPosition: Vector3): void {
    this.repathTimer -= dt;
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);

    if (this.queuedReaction) {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) {
        const reaction = this.queuedReaction;
        this.queuedReaction = null;
        this.animator.play(reaction, { force: true });
        this.rig.setExpression('happy');
        this.bubble.show(reaction === 'wave' ? 'happy' : 'heart', 1.3);
      }
    }

    if (!this.talking) {
      if (this.path.length > 0) {
        this.followPath(dt);
      } else {
        this.performActivity(dt, hour);
      }
    }

    // Ground and orient.
    this.position.y = lerp(this.position.y, walkHeight(this.position.x, this.position.z), 1 - Math.exp(-14 * dt));
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

    // Presence: name within earshot, and a bubble for whatever they are up to.
    const distance = Math.sqrt(distanceSq);
    this.nameplate.update(dt, distance);
    this.updateBubble(distance);
    this.bubble.update(dt);
  }

  /** Sticky status bubbles — a request to make, a nap — with reactions on top. */
  private updateBubble(distance: number): void {
    const current = this.bubble.current;
    // Reactions (hearts, waves) are timed and own the bubble while they play.
    if (current === 'heart' || current === 'happy') return;
    if (distance > 24) {
      if (current) this.bubble.hide();
      return;
    }
    let wanted: 'exclaim' | 'sleep' | 'dots' | 'note' | null = null;
    if (this.talking) wanted = 'dots';
    else if (this.hasRequest) wanted = 'exclaim';
    else if (this.activity === 'sleep' && this.path.length === 0) wanted = 'sleep';
    else if ((this.activity === 'browse' || this.activity === 'tend') && this.path.length === 0 && Math.floor(this.activityTimer / 7) % 3 === 1) wanted = 'note';
    if (!wanted && this.chattingWith && this.animator.currentClip === 'talk') wanted = 'dots';
    if (wanted && current !== wanted) this.bubble.show(wanted, Infinity);
    else if (!wanted && current) this.bubble.hide();
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
        if (this.chattingWith) {
          // Face the other villager and gesture; the manager pairs them.
          const other = this.chattingWith;
          this.facing = dampAngle(this.facing, Math.atan2(other.position.x - this.position.x, other.position.z - this.position.z), 0.25, dt);
          this.chatTimer += dt;
          // Take turns: one talks while the other listens and nods.
          const speaking = Math.floor(this.chatTimer / 3.2) % 2 === (this.def.id < other.def.id ? 0 : 1);
          if (speaking) this.animator.play('talk');
          else if (!this.animator.isBusy && Math.random() < dt * 0.35) this.animator.play('nod', { force: true });
          else if (!this.animator.isBusy) this.animator.play('idle');
          break;
        }
        this.animator.play(hour >= 22 || hour < 6 ? 'idleTired' : 'idle');
        // Look around now and then, so standing still is not standing frozen.
        this.glanceTimer -= dt;
        if (this.glanceTimer <= 0) {
          this.glanceTimer = 4 + Math.random() * 6;
          this.glanceYaw = (Math.random() - 0.5) * 1.6;
        }
        this.facing = dampAngle(this.facing, this.facing + this.glanceYaw * dt * 0.4, 0.3, dt);
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
    this.nameplate.dispose();
    this.bubble.dispose();
  }
}
