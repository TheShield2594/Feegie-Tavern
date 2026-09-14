import { DEFAULT_LOOK } from '@/data/clothing';
import { VILLAGERS } from '@/data/villagers';
import type { EventBus } from '@/core/EventBus';
import { migrate } from './migrations';
import {
  DEFAULT_SETTINGS,
  LEGACY_V2_KEY,
  LEGACY_V4_KEY_PREFIX,
  SAVE_KEY_PREFIX,
  SAVE_VERSION,
  type SaveDataV5,
} from './schema';

export interface SlotSummary {
  slot: number;
  exists: boolean;
  day: number;
  coins: number;
  donated: number;
  playtimeSeconds: number;
  savedAt: number;
  /** Set when the slot holds a save from an older schema that will be upgraded. */
  legacyVersion: number | null;
}

export const SLOT_COUNT = 3;

export function createNewSave(slot: number): SaveDataV5 {
  const relationships: SaveDataV5['relationships'] = {};
  for (const v of VILLAGERS) {
    relationships[v.id] = { friendship: v.startingFriendship, lastTalkedDay: 0, giftsGiven: 0 };
  }

  return {
    version: SAVE_VERSION,
    slot,
    savedAt: Date.now(),
    playtimeSeconds: 0,
    clock: { day: 1, minutes: 8 * 60 },
    weather: { kind: 'clear', remaining: 360 },
    player: {
      position: { x: 0, y: 0, z: 6 },
      facing: Math.PI,
      coins: 250,
      look: { ...DEFAULT_LOOK },
      inventory: [],
      bagLevel: 0,
      materials: { wood: 2, stone: 2, fiber: 2 },
      seeds: 3,
      toolLevels: { rod: 1, net: 1, shovel: 1, axe: 1, wateringCan: 1 },
      stats: { totalCaught: 0, totalSold: 0, harvested: 0, flowersPlanted: 0, cooked: 0, records: {} },
    },
    museum: { donated: [] },
    home: { level: 1, styleId: 'style.harbourBlue', ownedStyles: [], ownedFurniture: [], placed: [] },
    farm: { plots: [] },
    world: { gardens: [], gatherables: [], townWorks: { bridge: false, stairs: false, lighthouse: false } },
    quests: { activeId: 'museum', progress: 0, issuedDay: 1, completedIds: [] },
    relationships,
    story: { stage: 0 },
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Owns everything that touches localStorage. Nothing else in the game reads or
 * writes storage directly, which is what makes the schema version meaningful.
 */
export class SaveSystem {
  private autosaveTimer = 0;
  private dirty = false;
  /**
   * Slots whose stored data was upgraded this session. Recorded because the
   * upgrade is written back immediately, so a later read cannot tell that a
   * migration happened — and the title screen wants to say so.
   */
  private migrated = new Map<number, number>();

  constructor(
    private bus: EventBus,
    /** Injected so tests and non-browser tooling can drive it. */
    private storage: Storage | null = safeStorage(),
  ) {}

  key(slot: number): string {
    return `${SAVE_KEY_PREFIX}${slot}`;
  }

  /** Reads a slot, running migrations if the stored blob predates the current schema. */
  read(slot: number): { data: SaveDataV5; migratedFrom: number | null } | null {
    if (!this.storage) return null;

    let raw = this.storage.getItem(this.key(slot));
    let source: 'current' | 'legacy' = 'current';

    if (!raw) {
      raw = this.storage.getItem(`${LEGACY_V4_KEY_PREFIX}${slot}`);
      if (raw) source = 'legacy';
    }
    // The very first prototype only ever had one unnumbered save.
    if (!raw && slot === 1) {
      raw = this.storage.getItem(LEGACY_V2_KEY);
      if (raw) source = 'legacy';
    }
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = migrate(parsed);
      result.data.slot = slot;
      if (source === 'legacy' || result.migratedFrom !== null) {
        // Persist the upgraded blob immediately so the migration only ever runs
        // once, and leave the legacy key untouched as a fallback.
        this.writeRaw(slot, result.data);
        this.migrated.set(slot, result.migratedFrom ?? 4);
      }
      return { data: result.data, migratedFrom: result.migratedFrom ?? this.migrated.get(slot) ?? null };
    } catch (err) {
      console.error(`[save] Slot ${slot} could not be read`, err);
      return null;
    }
  }

  summary(slot: number): SlotSummary {
    const empty: SlotSummary = {
      slot,
      exists: false,
      day: 1,
      coins: 0,
      donated: 0,
      playtimeSeconds: 0,
      savedAt: 0,
      legacyVersion: null,
    };
    const result = this.read(slot);
    if (!result) return empty;
    return {
      slot,
      exists: true,
      day: result.data.clock.day,
      coins: result.data.player.coins,
      donated: result.data.museum.donated.length,
      playtimeSeconds: result.data.playtimeSeconds,
      savedAt: result.data.savedAt,
      legacyVersion: result.migratedFrom ?? this.migrated.get(slot) ?? null,
    };
  }

  summaries(): SlotSummary[] {
    return Array.from({ length: SLOT_COUNT }, (_, i) => this.summary(i + 1));
  }

  write(data: SaveDataV5): void {
    this.writeRaw(data.slot, data);
    this.dirty = false;
    this.bus.emit('save:written', { slot: data.slot });
  }

  private writeRaw(slot: number, data: SaveDataV5): void {
    if (!this.storage) return;
    try {
      data.savedAt = Date.now();
      this.storage.setItem(this.key(slot), JSON.stringify(data));
    } catch (err) {
      console.error('[save] Write failed', err);
    }
  }

  erase(slot: number): void {
    if (!this.storage) return;
    this.storage.removeItem(this.key(slot));
    this.storage.removeItem(`${LEGACY_V4_KEY_PREFIX}${slot}`);
    if (slot === 1) this.storage.removeItem(LEGACY_V2_KEY);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Called each frame; writes at most once every `interval` seconds. */
  tick(dt: number, snapshot: () => SaveDataV5, interval = 20): void {
    this.autosaveTimer += dt;
    if (this.autosaveTimer < interval) return;
    this.autosaveTimer = 0;
    if (!this.dirty) return;
    this.write(snapshot());
  }
}

function safeStorage(): Storage | null {
  try {
    const probe = '__cozycove__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Private browsing, blocked site data, or a sandboxed frame. The game still
    // runs; it just cannot persist.
    console.warn('[save] localStorage unavailable — progress will not persist.');
    return null;
  }
}
