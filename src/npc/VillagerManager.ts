import { Group, Vector3 } from 'three';
import { VILLAGERS, type VillagerDef } from '@/data/villagers';
import type { EventBus } from '@/core/EventBus';
import { LANDMARKS } from '@/world/heightfield';
import { Navigation } from './Navigation';
import { Villager } from './Villager';

/**
 * Owns every villager: their models, their navigation grid, and the hourly
 * schedule tick that moves the island through its day.
 */
export class VillagerManager {
  readonly group = new Group();
  readonly navigation: Navigation;
  readonly villagers = new Map<string, Villager>();

  private lastHour = -1;

  constructor(
    private bus: EventBus,
    obstacles: { x: number; z: number; radius: number }[] = [],
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

  /** Places everyone where their schedule says they should be, with no walking. */
  snapToSchedule(hour: number): void {
    for (const villager of this.villagers.values()) {
      villager.applySchedule(hour, true);
      // Skip the walk: put them at the anchor immediately.
      const entry = villager.def.schedule.reduce(
        (best, e) => (hour >= e.from ? e : best),
        villager.def.schedule[0],
      );
      const target = LANDMARKS[entry.at];
      if (target) villager.goTo(target.x + villager.anchorOffset.x, target.z + villager.anchorOffset.z, entry.activity);
      // Anchors can sit inside an obstacle (the fountain); stand beside it.
      const spot = target
        ? this.navigation.snapToOpen(target.x + villager.anchorOffset.x, target.z + villager.anchorOffset.z)
        : null;
      villager.position.x = spot?.x ?? villager.position.x;
      villager.position.z = spot?.z ?? villager.position.z;
    }
    this.lastHour = hour;
  }

  private chatTimer = 0;

  update(dt: number, hour: number, playerPosition: Vector3): void {
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      for (const villager of this.villagers.values()) villager.applySchedule(hour);
    }
    this.pairChats(dt);
    for (const villager of this.villagers.values()) {
      villager.update(dt, hour, playerPosition);
    }
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
    const all = [...this.villagers.values()];
    for (const v of all) {
      const partner = v.chattingWith;
      if (!partner) continue;
      const still = v.activity === 'idle' && partner.activity === 'idle' && !v.talking && !partner.talking
        && !v.isMoving && !partner.isMoving && v.position.distanceToSquared(partner.position) < 5.5 * 5.5;
      if (!still) {
        v.chattingWith = null;
        partner.chattingWith = null;
      }
    }
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.chattingWith || a.activity !== 'idle' || a.talking || a.isMoving) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (b.chattingWith || b.activity !== 'idle' || b.talking || b.isMoving) continue;
        if (a.position.distanceToSquared(b.position) > 4.5 * 4.5) continue;
        a.chattingWith = b;
        b.chattingWith = a;
        break;
      }
    }
  }

  /** Everyone within `radius` of a point answers a greeting. */
  greetFrom(position: Vector3, radius = 7): number {
    let count = 0;
    for (const villager of this.villagers.values()) {
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
