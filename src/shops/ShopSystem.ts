import { FURNITURE, HOUSE_STYLES } from '@/data/furniture';
import { Rng } from '@/util/rng';

export interface StockEntry {
  defId: string;
  price: number;
  kind: 'furniture' | 'seed' | 'clothing';
}

/**
 * Bruno's rotating stock. Seeded by the day so the shelves are the same
 * whenever the player comes back that day, and different tomorrow.
 */
export class ShopSystem {
  private cachedDay = -1;
  private cached: StockEntry[] = [];

  stockFor(day: number, ownedFurniture: string[]): StockEntry[] {
    if (day === this.cachedDay) return this.cached;

    const rng = new Rng(day * 7919 + 13);
    const entries: StockEntry[] = [];

    // Prefer furniture the player does not own yet — a shop that only sells
    // duplicates stops being interesting by day three.
    const unowned = FURNITURE.filter((f) => !ownedFurniture.includes(f.id));
    const pool = unowned.length >= 3 ? unowned : FURNITURE;
    const picks = new Set<string>();
    while (picks.size < Math.min(4, pool.length)) {
      picks.add(pool[rng.int(0, pool.length)].id);
    }
    for (const id of picks) {
      const def = FURNITURE.find((f) => f.id === id)!;
      // Small daily price swing, so waiting a day can pay off.
      const swing = 1 + rng.range(-0.12, 0.14);
      entries.push({ defId: id, price: Math.round((def.price * swing) / 5) * 5, kind: 'furniture' });
    }

    entries.push({ defId: 'seed.mixed', price: 80, kind: 'seed' });

    // One exterior style is offered at a time once the basics are in stock.
    const style = HOUSE_STYLES[rng.int(1, HOUSE_STYLES.length)];
    entries.push({ defId: style.id, price: style.price, kind: 'clothing' });

    this.cachedDay = day;
    this.cached = entries;
    return entries;
  }
}
