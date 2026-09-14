import type { EventBus } from '@/core/EventBus';
import { getItemDef } from '@/data/items';
import { SPECIES_BY_ID } from '@/data/species';
import type { InventoryItem, ItemCategory, Rarity, SpeciesDef } from '@/items/types';

export const BASE_CAPACITY = 24;
export const CAPACITY_PER_LEVEL = 8;

export interface Stack {
  key: string;
  defId: string;
  name: string;
  category: ItemCategory;
  rarity: Rarity;
  items: InventoryItem[];
  /** Total sell value of the stack. */
  value: number;
}

export type SortMode = 'category' | 'value' | 'name' | 'recent';

let uidCounter = 0;

export function makeItem(defId: string, options: { sizeCm?: number; day?: number } = {}): InventoryItem | null {
  const def = getItemDef(defId);
  if (!def) return null;
  uidCounter += 1;
  return {
    uid: `${defId}#${Date.now().toString(36)}${uidCounter.toString(36)}`,
    defId: def.id,
    name: def.name,
    category: def.category,
    rarity: def.rarity,
    value: def.value,
    ...(options.sizeCm !== undefined ? { sizeCm: options.sizeCm } : {}),
    acquiredDay: options.day ?? 1,
  };
}

/** Rolls a plausible size for a species, used for catch cards and records. */
export function rollSize(species: SpeciesDef): number | undefined {
  if (species.sizeCm === undefined) return undefined;
  const variance = species.sizeVarianceCm ?? species.sizeCm * 0.25;
  // Two samples averaged gives a soft bell, so trophies stay uncommon.
  const roll = (Math.random() + Math.random()) / 2;
  return Math.round((species.sizeCm + (roll * 2 - 1) * variance) * 10) / 10;
}

/**
 * The player's bag.
 *
 * Items are stored individually (each catch has its own size and uid) but
 * presented as stacks, which is what lets the UI show "Turnip ×6" while the
 * museum still knows exactly which specimen was donated.
 */
export class Inventory {
  private items: InventoryItem[] = [];
  bagLevel = 0;

  constructor(private bus: EventBus) {}

  get capacity(): number {
    return BASE_CAPACITY + this.bagLevel * CAPACITY_PER_LEVEL;
  }

  get count(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  get all(): readonly InventoryItem[] {
    return this.items;
  }

  add(item: InventoryItem): boolean {
    if (this.isFull) {
      this.bus.emit('inventory:full', { attempted: item });
      return false;
    }
    this.items.push(item);
    this.bus.emit('item:gained', { item, quantity: 1 });
    this.emitChanged();
    return true;
  }

  /** Convenience for spawning by definition id. */
  addById(defId: string, options: { sizeCm?: number; day?: number } = {}): InventoryItem | null {
    const item = makeItem(defId, options);
    if (!item) return null;
    return this.add(item) ? item : null;
  }

  remove(uid: string): InventoryItem | null {
    const index = this.items.findIndex((i) => i.uid === uid);
    if (index < 0) return null;
    const [item] = this.items.splice(index, 1);
    this.bus.emit('item:removed', { itemId: uid, quantity: 1 });
    this.emitChanged();
    return item;
  }

  /** Removes the first item matching a definition. Returns it, or null. */
  removeOneOf(defId: string): InventoryItem | null {
    const item = this.items.find((i) => i.defId === defId && !i.favorite);
    return item ? this.remove(item.uid) : null;
  }

  /** Removes the first unlocked item in a category — used by cooking. */
  removeOneOfCategory(category: ItemCategory, exclude: Set<string> = new Set()): InventoryItem | null {
    const item = this.items.find((i) => i.category === category && !i.favorite && !exclude.has(i.uid));
    return item ? this.remove(item.uid) : null;
  }

  has(defId: string): boolean {
    return this.items.some((i) => i.defId === defId);
  }

  countOf(defId: string): number {
    return this.items.filter((i) => i.defId === defId).length;
  }

  countOfCategory(category: ItemCategory): number {
    return this.items.filter((i) => i.category === category).length;
  }

  find(uid: string): InventoryItem | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  toggleFavorite(uid: string): void {
    const item = this.find(uid);
    if (!item) return;
    item.favorite = !item.favorite;
    this.emitChanged();
  }

  /** Groups items into display stacks, sorted by the requested mode. */
  stacks(sort: SortMode = 'category', filter?: ItemCategory | 'all'): Stack[] {
    const map = new Map<string, Stack>();
    for (const item of this.items) {
      if (filter && filter !== 'all' && item.category !== filter) continue;
      // Sized specimens never merge — a 22cm and a 61cm pike are not "×2".
      const key = item.sizeCm !== undefined ? item.uid : item.defId;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
        existing.value += item.value;
      } else {
        map.set(key, {
          key,
          defId: item.defId,
          name: item.name,
          category: item.category,
          rarity: item.rarity,
          items: [item],
          value: item.value,
        });
      }
    }

    const order: ItemCategory[] = ['fish', 'sea', 'bug', 'fossil', 'crop', 'fruit', 'meal', 'material', 'seed', 'furniture', 'tool', 'clothing'];
    const stacks = [...map.values()];
    switch (sort) {
      case 'value':
        stacks.sort((a, b) => b.value / b.items.length - a.value / a.items.length);
        break;
      case 'name':
        stacks.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'recent': {
        // Items are appended, so index 0 is the oldest; a stack should sort by
        // its newest member or adding to it never moves it up the list.
        const newest = (s: Stack) => s.items.reduce((max, i) => Math.max(max, i.acquiredDay ?? 0), 0);
        stacks.sort((a, b) => newest(b) - newest(a));
        break;
      }
      case 'category':
      default:
        stacks.sort((a, b) => {
          const d = order.indexOf(a.category) - order.indexOf(b.category);
          return d !== 0 ? d : a.name.localeCompare(b.name);
        });
        break;
    }
    return stacks;
  }

  /** True when the item is a species the museum has not seen yet. */
  static isDonatable(item: InventoryItem): boolean {
    return SPECIES_BY_ID.has(item.defId);
  }

  load(items: InventoryItem[], bagLevel: number): void {
    this.items = items.slice(0, BASE_CAPACITY + bagLevel * CAPACITY_PER_LEVEL);
    this.bagLevel = bagLevel;
    this.emitChanged();
  }

  serialize(): InventoryItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  private emitChanged(): void {
    this.bus.emit('inventory:changed', { stacks: [], capacity: this.capacity });
  }
}
