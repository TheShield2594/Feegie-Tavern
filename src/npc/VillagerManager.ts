import { Group, Vector3 } from 'three';
import { VILLAGERS, type ScheduleEntry, type VillagerDef } from '@/data/villagers';
import type { EventBus } from '@/core/EventBus';
import type { BuildingId } from '@/world/Buildings';
import { Navigation } from './Navigation';
import { Villager, type DoorTrip } from './Villager';

/** Where a building's door is, in world space, and which way it faces out. */
export interface BuildingDoor {
  doorway: Vector3;
  facing: number;
}

/** The room the player is standing in, with its anchors in world space. */
export interface ActiveInterior {
  building: BuildingId;
  anchors: Record<string, Vector3>;
}

/**
 * Owns every villager: their models, their navigation grid, and the hourly
 * schedule tick that moves the island through its day.
 *
 * It also owns the boundary between outside and inside. A schedule entry can
 * name a room rather than a point on the island, and the two are different
 * kinds of place: rooms are built when the player opens the door and thrown
 * away when they leave, so their anchors exist only part of the time, and the
 * only way between the two is through a door. Villagers know how to walk and
 * how to stand still; deciding which world they are standing in is here.
 */
export class VillagerManager {
  readonly group = new Group();
  readonly navigation: Navigation;
  readonly villagers = new Map<string, Villager>();

  private lastHour = -1;
  private activeInterior: ActiveInterior | null = null;

  constructor(
    private bus: EventBus,
    obstacles: { x: number; z: number; radius: number }[] = [],
    private doors: Map<BuildingId, BuildingDoor> = new Map(),
  ) {
    this.group.name = 'Villagers';
    this.navigation = new Navigation(1.8);
    for (const obstacle of obstacles) {
      this.navigation.addObstacle(obstacle.x, obstacle.z, obstacle.radius);
    }

    for (const def of VILLAGERS) {
      const villager = new Villager(def, this.navigation);
      this.villagers.set(def.id, villager);
      this.group.add(villager.group);
    }
  }

  get(id: string): Villager | undefined {
    return this.villagers.get(id);
  }

  /**
   * Tells the villagers which room the player has just walked into, with its
   * anchors already in world space, or null on the way back out.
   *
   * Anyone whose schedule has them in that room is put where they belong now
   * that there is somewhere to put them — a shopkeeper is behind the counter
   * before the door finishes opening, not walking over to it.
   */
  setActiveInterior(interior: ActiveInterior | null): void {
    this.activeInterior = interior;
    if (interior) {
      for (const villager of this.villagers.values()) {
        if (villager.indoors !== interior.building) continue;
        this.placeInside(villager, interior.building, villager.indoorAnchor ?? 'exit', false);
      }
    }
    this.refreshPresence();
  }

  /** Whether a villager is in the same world as the player right now. */
  private isPresent(villager: Villager): boolean {
    return villager.indoors === (this.activeInterior?.building ?? null);
  }

  /**
   * Draws only the people in the room the player is in — or on the island,
   * when the player is on it.
   *
   * Separate from `update` because it has to hold even when nothing is
   * ticking: the title screen and the pause menu both render the world with
   * the simulation stopped, and someone shut in a building must not be
   * standing on its doorstep in either.
   */
  refreshPresence(): void {
    for (const villager of this.villagers.values()) {
      villager.group.visible = this.isPresent(villager);
    }
  }

  /** Places everyone where their schedule says they should be, with no walking. */
  snapToSchedule(hour: number): void {
    for (const villager of this.villagers.values()) {
      this.routeToSchedule(villager, hour, true);
    }
    this.lastHour = hour;
    // Before the next frame, so a load never flashes someone standing on the
    // doorstep of the building they are meant to be shut inside.
    this.refreshPresence();
  }

  private chatTimer = 0;

  update(dt: number, hour: number, playerPosition: Vector3): void {
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      for (const villager of this.villagers.values()) this.routeToSchedule(villager, hour, false);
    }
    this.pairChats(dt);
    for (const villager of this.villagers.values()) {
      villager.update(dt, hour, playerPosition);
      const trip = villager.doorArrival;
      if (trip) this.completeDoorTrip(villager, trip, hour);
    }
    this.refreshPresence();
  }

  // --- Going in and out ------------------------------------------------------

  /**
   * Sends a villager wherever the hour says they should be.
   *
   * `snap` is for a load or a warp, where nobody is watching and everyone
   * should simply already be in place. Otherwise the trip is made on foot: an
   * indoor block starts with a walk to that building's door, and leaving one
   * starts from the doorstep — or, if the player is in the room to see it,
   * with a walk to the door from the inside.
   */
  private routeToSchedule(villager: Villager, hour: number, snap: boolean): void {
    const { entry, index } = villager.entryFor(hour);
    if (!villager.beginEntry(entry, index, snap)) return;
    villager.clearDoorTrip();

    // Already in the right building: cross the floor rather than going out of
    // the door and back in through it.
    if (entry.inside && villager.indoors === entry.inside.building) {
      this.placeInside(villager, entry.inside.building, entry.inside.anchor, !snap);
      return;
    }

    if (villager.indoors !== null) {
      // Leaving a room. Walk out through the door when the player is in it to
      // see it; otherwise step straight onto the doorstep, unwatched.
      const exit = !snap && this.isPresent(villager) ? this.activeInterior?.anchors.exit : undefined;
      if (exit) {
        villager.headForDoor(exit.x, exit.z, { kind: 'out' });
        return;
      }
      this.stepOutside(villager);
    }
    this.sendToEntry(villager, entry, snap);
  }

  /** Sends a villager who is out on the island wherever the entry wants them. */
  private sendToEntry(villager: Villager, entry: ScheduleEntry, snap: boolean): void {
    const destination = entry.inside;
    if (!destination) {
      this.walkToOutdoorAnchor(villager, entry, snap);
      return;
    }
    const door = this.doors.get(destination.building);
    // With no door to walk to, put them inside anyway: the landmark an indoor
    // entry names is the building's own footprint, which is an obstacle.
    if (snap || !door) {
      this.placeInside(villager, destination.building, destination.anchor, false);
      return;
    }
    villager.headForDoor(door.doorway.x, door.doorway.z, { kind: 'in', ...destination });
  }

  /** Finishes a trip through a door, one frame after the walk to it ends. */
  private completeDoorTrip(villager: Villager, trip: DoorTrip, hour: number): void {
    villager.clearDoorTrip();
    const { entry } = villager.entryFor(hour);
    if (trip.kind === 'in') {
      this.placeInside(villager, trip.building, trip.anchor, true);
      // Getting there was a walk; what they came to do is in the schedule.
      villager.activity = entry.activity;
      return;
    }
    this.stepOutside(villager);
    this.sendToEntry(villager, entry, false);
  }

  /**
   * Stands a villager at a named spot in a building's interior.
   *
   * The room only exists while the player is in it. When it does, `walkIn`
   * brings them through the door and across the floor, so the player watches
   * the shopkeeper take their place rather than blink into it. When it does
   * not, the position is a placeholder outside the door — nobody can see them,
   * and it keeps them out of the distance checks that decide who is nearby.
   */
  private placeInside(villager: Villager, building: BuildingId, anchor: string, walkIn: boolean): void {
    const interior = this.activeInterior?.building === building ? this.activeInterior : null;
    const spot = interior?.anchors[anchor];
    if (!interior || !spot) {
      const parked = this.doors.get(building)?.doorway;
      villager.enterInterior(building, anchor, parked?.x ?? 0, parked?.y ?? 0, parked?.z ?? 0, 0);
      return;
    }

    // Face the way a visitor comes in, so a counter has someone behind it
    // rather than someone's back.
    const exit = interior.anchors.exit;
    const facing = exit ? Math.atan2(exit.x - spot.x, exit.z - spot.z) : 0;

    if (walkIn && villager.indoors !== building && exit) {
      villager.enterInterior(building, anchor, exit.x, exit.y, exit.z, facing);
      villager.moveWithinInterior(spot.x, spot.z);
      return;
    }
    if (walkIn && villager.indoors === building) {
      villager.indoorAnchor = anchor;
      villager.moveWithinInterior(spot.x, spot.z);
      return;
    }
    villager.enterInterior(building, anchor, spot.x, spot.y, spot.z, facing);
  }

  /** Puts a villager back on the island, on the step of the door they used. */
  private stepOutside(villager: Villager): void {
    const door = villager.indoors ? this.doors.get(villager.indoors) : undefined;
    const spot = door
      ? this.navigation.snapToOpen(door.doorway.x, door.doorway.z)
      : this.navigation.snapToOpen(villager.position.x, villager.position.z);
    villager.leaveInterior(spot.x, spot.z, door?.facing ?? villager.facing);
  }

  private walkToOutdoorAnchor(villager: Villager, entry: ScheduleEntry, snap: boolean): void {
    const target = villager.outdoorAnchorFor(entry);
    // Anchors can sit inside an obstacle (the fountain); stand beside it.
    const spot = this.navigation.snapToOpen(target.x, target.z);
    if (snap) villager.snapTo(spot.x, spot.z, entry.activity);
    else villager.goTo(spot.x, spot.z, entry.activity);
  }

  /**
   * Two idle neighbours standing near each other fall into conversation.
   * Re-evaluated every couple of seconds; a pair breaks up as soon as either
   * walks off, starts talking to the player, or their schedule moves them.
   */
  private pairChats(dt: number): void {
    this.chatTimer -= dt;
    if (this.chatTimer > 0) return;
    this.chatTimer = 2;
    const all = [...this.villagers.values()].filter((v) => this.isPresent(v));
    for (const v of all) {
      const partner = v.chattingWith;
      if (!partner) continue;
      const still = v.activity === 'idle' && partner.activity === 'idle' && !v.talking && !partner.talking
        && !v.isMoving && !partner.isMoving && v.position.distanceToSquared(partner.position) < 5.5 * 5.5;
      if (!still) {
        v.endChat();
        partner.endChat();
      }
    }
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.chattingWith || a.activity !== 'idle' || a.talking || a.isMoving) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.chattingWith || b.activity !== 'idle' || b.talking || b.isMoving) continue;
        if (a.position.distanceToSquared(b.position) > 4.5 * 4.5) continue;
        a.beginChat(b);
        b.beginChat(a);
        break;
      }
    }
  }

  /** Everyone within `radius` of a point answers a greeting. */
  greetFrom(position: Vector3, radius = 7): number {
    let count = 0;
    for (const villager of this.villagers.values()) {
      if (!this.isPresent(villager)) continue;
      if (villager.position.distanceToSquared(position) > radius * radius) continue;
      villager.greetBack();
      count += 1;
    }
    return count;
  }

  /** Nearest villager within range, for the interaction system. */
  nearest(position: Vector3, radius: number): Villager | null {
    let best: Villager | null = null;
    let bestDist = radius * radius;
    for (const villager of this.villagers.values()) {
      // Someone parked in an unloaded room is nowhere the player can reach.
      if (!this.isPresent(villager)) continue;
      const d = villager.position.distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = villager;
      }
    }
    return best;
  }

  /** Picks the line a villager says right now, given time and weather. */
  lineFor(def: VillagerDef, hour: number, raining: boolean, seenToday: boolean): string[] {
    const lines: string[] = [];
    lines.push(def.greetings[Math.floor(Math.random() * def.greetings.length)]);

    const pool = raining
      ? def.rainLines
      : hour >= 20 || hour < 6
        ? def.nightLines
        : def.lines;
    lines.push(pool[Math.floor(Math.random() * pool.length)]);

    // A second line only on the first conversation of the day, so repeat
    // chats stay short rather than becoming a wall of text.
    if (!seenToday && def.lines.length > 1) {
      const extra = def.lines[Math.floor(Math.random() * def.lines.length)];
      if (extra !== lines[1]) lines.push(extra);
    }
    return lines;
  }

  markerFor(villagerId: string, hasRequest: boolean): void {
    const villager = this.villagers.get(villagerId);
    if (villager) villager.hasRequest = hasRequest;
    void this.bus;
  }

  dispose(): void {
    for (const villager of this.villagers.values()) villager.dispose();
  }
}
