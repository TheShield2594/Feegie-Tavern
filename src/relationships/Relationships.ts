import type { EventBus } from '@/core/EventBus';
import { VILLAGERS } from '@/data/villagers';
import { ALL_ITEMS } from '@/data/items';
import type { RelationshipData } from '@/save/schema';
import type { ItemCategory } from '@/items/types';

export const MAX_FRIENDSHIP = 100;
/** Friendship points per heart. */
export const POINTS_PER_HEART = 20;

/**
 * Friendship, daily conversations, and the small favours villagers ask for.
 */
export class Relationships {
  private data = new Map<string, RelationshipData>();

  constructor(private bus: EventBus) {
    for (const villager of VILLAGERS) {
      this.data.set(villager.id, { friendship: villager.startingFriendship, lastTalkedDay: 0, giftsGiven: 0 });
    }
  }

  get(id: string): RelationshipData {
    let entry = this.data.get(id);
    if (!entry) {
      entry = { friendship: 0, lastTalkedDay: 0, giftsGiven: 0 };
      this.data.set(id, entry);
    }
    return entry;
  }

  friendship(id: string): number {
    return this.get(id).friendship;
  }

  hearts(id: string): number {
    return Math.min(5, Math.floor(this.friendship(id) / POINTS_PER_HEART));
  }

  get total(): number {
    let sum = 0;
    for (const entry of this.data.values()) sum += entry.friendship;
    return sum;
  }

  /** Adds friendship and reports whether a new heart was earned. */
  add(id: string, amount: number): { gained: boolean; value: number } {
    const entry = this.get(id);
    const beforeHearts = Math.floor(entry.friendship / POINTS_PER_HEART);
    entry.friendship = Math.min(MAX_FRIENDSHIP, entry.friendship + amount);
    const afterHearts = Math.floor(entry.friendship / POINTS_PER_HEART);
    this.bus.emit('friendship:changed', { villagerId: id, value: entry.friendship, delta: amount });
    if (afterHearts > beforeHearts) this.bus.emit('audio:sfx', { id: 'friendship.up' });
    return { gained: afterHearts > beforeHearts, value: entry.friendship };
  }

  /** First conversation of the day is worth more than the tenth. */
  talk(id: string, day: number): { gained: boolean; firstToday: boolean } {
    const entry = this.get(id);
    const firstToday = entry.lastTalkedDay !== day;
    entry.lastTalkedDay = day;
    const result = this.add(id, firstToday ? 4 : 0.5);
    return { gained: result.gained, firstToday };
  }

  hasSpokenToday(id: string, day: number): boolean {
    return this.get(id).lastTalkedDay === day;
  }

  /** Issues a small fetch request, weighted toward what the villager likes. */
  issueRequest(id: string, day: number): RelationshipData['request'] | undefined {
    const villager = VILLAGERS.find((v) => v.id === id);
    const entry = this.get(id);
    if (!villager || (entry.request && !entry.request.done && day - entry.request.day < 3)) return entry.request;

    const preferred = ALL_ITEMS.filter((item) => villager.favoriteCategories.includes(item.category));
    const pool = preferred.length > 0 ? preferred : ALL_ITEMS;
    const wanted = pool[Math.floor(Math.random() * pool.length)];
    entry.request = {
      itemDefId: wanted.id,
      reward: Math.round(wanted.value * 1.8 + 60),
      done: false,
      day,
    };
    return entry.request;
  }

  completeRequest(id: string): number {
    const entry = this.get(id);
    if (!entry.request || entry.request.done) return 0;
    entry.request.done = true;
    entry.giftsGiven += 1;
    this.add(id, 12);
    return entry.request.reward;
  }

  /** How much a villager appreciates a given gift category. */
  giftValue(id: string, category: ItemCategory): number {
    const villager = VILLAGERS.find((v) => v.id === id);
    if (!villager) return 3;
    return villager.favoriteCategories.includes(category) ? 8 : 3;
  }

  serialize(): Record<string, RelationshipData> {
    const out: Record<string, RelationshipData> = {};
    for (const [id, entry] of this.data) out[id] = { ...entry };
    return out;
  }

  load(data: Record<string, RelationshipData>): void {
    for (const [id, entry] of Object.entries(data ?? {})) {
      this.data.set(id, { ...this.get(id), ...entry });
    }
  }
}
