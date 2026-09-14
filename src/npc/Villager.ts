import { Group, Vector3 } from 'three';
import { CharacterAnimator } from '@/player/CharacterAnimator';
import { CharacterRig } from '@/player/CharacterRig';
import { dampAngle, lerp } from '@/util/math';
import { EmoteBubble, Nameplate } from '@/rendering/WorldLabel';
import { LANDMARKS, terrainHeight, walkHeight } from '@/world/heightfield';
import type { ScheduleEntry, VillagerDef } from '@/data/villagers';
import type { BuildingId } from '@/world/Buildings';
import type { Navigation, NavPoint } from './Navigation';

export type VillagerActivity = ScheduleEntry['activity'];

/**
 * A walk to a door that is not finished when the walking stops. `in` carries
 * the room and the spot inside it the villager is heading for; `out` puts them
 * back on the island. The manager reads it off `doorArrival` and completes it,
 * because only the manager knows where doors lead.
 */
export type DoorTrip =
  | { kind: 'in'; building: BuildingId; anchor: string }
  | { kind: 'out' };

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

  /**
   * The building whose interior they are standing in, or null for outdoors.
   *
   * Interiors are laid out around their own origin far from the island, so a
   * villager who is inside is at a world position the terrain knows nothing
   * about: grounding, wandering and the navigation grid are all suspended
   * while this is set. The manager owns the value — it is the only thing that
   * knows where the doors are.
   */
  indoors: BuildingId | null = null;
  /** Floor height of the interior they are in, in world space. */
  private floorY = 0;
  /** Which room of which building they stand in, by the room's anchor name. */
  indoorAnchor: string | null = null;
  /**
   * Set while they are walking to a door on their way somewhere else. The
   * manager polls `doorArrival` and performs the step through.
   */
  private doorTrip: DoorTrip | null = null;
  private atDoor = false;

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
  entryFor(hour: number): { entry: ScheduleEntry; index: number } {
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

  /**
   * Adopts an entry's label and activity without deciding where to stand.
   * Routing is the manager's job: an entry can name a room rather than a point
   * on the island, and only the manager knows where the doors are and which
   * interior is loaded. Returns false when the entry has not changed.
   */
  beginEntry(entry: ScheduleEntry, index: number, force: boolean): boolean {
    if (index === this.lastEntryIndex && !force) return false;
    this.lastEntryIndex = index;
    this.scheduleLabel = entry.label;
    this.activity = entry.activity;
    return true;
  }

  /** The outdoor point this villager takes when an entry names a landmark. */
  outdoorAnchorFor(entry: ScheduleEntry): { x: number; z: number } {
    const target = LANDMARKS[entry.at] ?? LANDMARKS['square.center'];
    return { x: target.x + this.anchorOffset.x, z: target.z + this.anchorOffset.z };
  }

  /**
   * Walks to a door and waits there for the manager to take them through.
   * Works in both directions: a door reached from the island is stepped
   * through into a room, and one reached from inside leads back out.
   */
  headForDoor(x: number, z: number, trip: DoorTrip): void {
    this.doorTrip = trip;
    this.atDoor = false;
    this.activity = 'walk';
    if (this.indoors !== null) this.moveWithinInterior(x, z);
    else this.goTo(x, z, 'walk');
  }

  /** Set for the frame the villager reaches a door it was sent to. */
  get doorArrival(): DoorTrip | null {
    return this.atDoor ? this.doorTrip : null;
  }

  /**
   * Puts the villager inside a room, at a world position within it. Their
   * outdoor route is dropped: the island's navigation grid does not describe
   * this space, and they are not on it any more.
   */
  enterInterior(building: BuildingId, anchor: string, x: number, y: number, z: number, facing: number): void {
    this.indoors = building;
    this.indoorAnchor = anchor;
    this.floorY = y;
    this.doorTrip = null;
    this.atDoor = false;
    this.anchor.set(x, y, z);
    this.position.set(x, y, z);
    this.group.position.copy(this.position);
    this.facing = facing;
    this.path = [];
    this.pathIndex = 0;
    this.activityTimer = 0;
  }

  /** Walks to a point in the room they are already standing in. */
  moveWithinInterior(x: number, z: number): void {
    if (this.indoors === null) return;
    this.anchor.set(x, this.floorY, z);
    this.path = [{ x, z }];
    this.pathIndex = 0;
  }

  /** Steps back out onto the island at a doorway, ready to walk somewhere. */
  leaveInterior(x: number, z: number, facing: number): void {
    this.indoors = null;
    this.indoorAnchor = null;
    this.doorTrip = null;
    this.atDoor = false;
    this.snapTo(x, z, this.activity);
    this.facing = facing;
  }

  /** Routes to a point on the island, through the navigation grid. */
  private repath(): void {
    if (this.talking || this.indoors !== null) return;
    this.path = this.nav.findPath(this.position.x, this.position.z, this.anchor.x, this.anchor.z);
    this.pathIndex = 0;
    this.repathTimer = 0;
  }

  /**
   * Places the villager at a point with no walk: anchor, position, ground
   * height and transform all move together, and any route in progress is
   * dropped so the next frame does not march them back along it.
   */
  snapTo(x: number, z: number, activity: VillagerActivity): void {
    this.activity = activity;
    this.anchor.set(x, terrainHeight(x, z), z);
    this.position.set(x, walkHeight(x, z), z);
    this.group.position.copy(this.position);
    this.path = [];
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.activityTimer = 0;
  }

  /** Starts a conversation with a neighbour, from the first beat. */
  beginChat(partner: Villager): void {
    this.chattingWith = partner;
    this.chatTimer = 0;
  }

  /** Ends a conversation and forgets its beat, so the next one starts fresh. */
  endChat(): void {
    this.chattingWith = null;
    this.chatTimer = 0;
  }

  /** Sends the villager to an arbitrary point — festivals, reactions, events. */
  goTo(x: number, z: number, activity: VillagerActivity = 'idle'): void {
    this.anchor.set(x, terrainHeight(x, z), z);
    this.activity = activity;
    this.repath();
  }

  /** Drops any pending trip through a door — they are wanted elsewhere. */
  clearDoorTrip(): void {
    this.doorTrip = null;
    this.atDoor = false;
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

  /** Per-frame: reactions, movement or activity, grounding, presence labels. */
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

    // Ground and orient. Indoors the room is a flat floor at a known height,
    // and the terrain heightfield does not describe where they are standing.
    const ground = this.indoors === null ? walkHeight(this.position.x, this.position.z) : this.floorY;
    this.position.y = lerp(this.position.y, ground, 1 - Math.exp(-14 * dt));
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
        // Reaching a door is the end of the walk but not of the errand; the
        // manager takes it from here on the next tick.
        if (this.doorTrip) this.atDoor = true;
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
        // Wander in a small circle around the anchor — outdoors only, since
        // the navigation grid covers the island and not the rooms on it.
        if (this.indoors !== null) {
          this.animator.play('idle');
          break;
        }
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

  /** Releases the rig, nameplate and bubble. */
  dispose(): void {
    this.rig.dispose();
    this.nameplate.dispose();
    this.bubble.dispose();
  }
}
