import { DEFAULT_LOOK, type CharacterLook, type HatId } from '@/data/clothing';
import { FURNITURE_BY_NAME } from '@/data/furniture';
import { ITEMS_BY_NAME } from '@/data/items';
import { SPECIES_BY_NAME } from '@/data/species';
import type { InventoryItem, ItemCategory, Rarity } from '@/items/types';
import { DEFAULT_SETTINGS, SAVE_VERSION, type AnySaveData, type SaveDataV6 } from './schema';

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** The v5 shape: v6 minus the fields added since. */
type LegacyV5 = Omit<SaveDataV6, 'version' | 'world'> & {
  version: 5;
  world: Omit<SaveDataV6['world'], 'orchardOpen'>;
};

let uidCounter = 0;
function uid(prefix = 'i'): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Prototype world coordinates were a 3400×2400 pixel plane; the island is now metres. */
const LEGACY_WORLD_W = 3400;
const LEGACY_WORLD_H = 2400;
const ISLAND_SIZE = 220;

function legacyToWorld(x: unknown, y: unknown): { x: number; z: number } {
  const px = num(x, LEGACY_WORLD_W / 2);
  const py = num(y, LEGACY_WORLD_H / 2);
  return {
    x: (px / LEGACY_WORLD_W - 0.5) * ISLAND_SIZE * 0.82,
    z: (py / LEGACY_WORLD_H - 0.5) * ISLAND_SIZE * 0.82,
  };
}

/** Prototype items were `{name, icon, rarity, value, type}` with no stable id. */
function convertLegacyItem(raw: unknown): InventoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, '');
  if (!name) return null;

  const def = ITEMS_BY_NAME.get(name.toLowerCase());
  const legacyType = str(r.type, 'material').toLowerCase();
  const categoryFromLegacy: Record<string, ItemCategory> = {
    fish: 'fish',
    bug: 'bug',
    fossil: 'fossil',
    sea: 'sea',
    crop: 'crop',
    fruit: 'fruit',
    meal: 'meal',
  };
  const rarityFromLegacy: Record<string, Rarity> = {
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    crafted: 'crafted',
  };

  return {
    uid: uid('legacy'),
    // Items with no matching definition keep a synthetic id so they still show,
    // sell and stack rather than vanishing from a returning player's bag.
    defId: def?.id ?? `legacy.${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
    name,
    category: def?.category ?? categoryFromLegacy[legacyType] ?? 'material',
    rarity: def?.rarity ?? rarityFromLegacy[str(r.rarity, 'common').toLowerCase()] ?? 'common',
    value: num(r.value, def?.value ?? 20),
    acquiredDay: 1,
  };
}

function convertLegacyLook(raw: unknown): CharacterLook {
  const r = (raw ?? {}) as Record<string, unknown>;
  const legacyHat = str(r.hat, 'none');
  // The prototype stored an emoji for the hat; map the ones it offered.
  const hatMap: Record<string, HatId> = {
    none: 'none',
    '🎩': 'beanie',
    '🧢': 'capBackwards',
    '👒': 'strawHat',
    '🌸': 'flowerCrown',
    '🪖': 'beanie',
  };
  return {
    ...DEFAULT_LOOK,
    skin: str(r.skin, DEFAULT_LOOK.skin),
    hairColor: str(r.hair, DEFAULT_LOOK.hairColor),
    shirtColor: str(r.shirt, DEFAULT_LOOK.shirtColor),
    hat: hatMap[legacyHat] ?? 'none',
  };
}

/**
 * v4 (round-5 prototype, `cozyCoveSaveV4_slot*`) → v5.
 *
 * The prototype kept a flat snapshot of live globals. Everything meaningful to
 * a returning player — progress, money, collection, friendships, story stage —
 * is carried across; purely presentational state is dropped.
 */
const migrate4to5: Migration = (data) => {
  const legacyPlayer = (data.player ?? {}) as Record<string, unknown>;
  const legacyMaterials = (legacyPlayer.materials ?? {}) as Record<string, unknown>;
  const legacyTools = (legacyPlayer.toolLevels ?? {}) as Record<string, unknown>;
  const legacyHouseStyle = (legacyPlayer.houseStyle ?? {}) as Record<string, unknown>;
  const legacyQuest = (data.activeQuest ?? {}) as Record<string, unknown>;
  const legacyWeather = (data.weather ?? {}) as Record<string, unknown>;

  const pos = legacyToWorld(legacyPlayer.x, legacyPlayer.y);

  const inventory = Array.isArray(legacyPlayer.inventory)
    ? (legacyPlayer.inventory.map(convertLegacyItem).filter(Boolean) as InventoryItem[])
    : [];

  // Museum donations were stored as whole item objects; keep only the species id.
  const donated = new Set<string>();
  if (Array.isArray(legacyPlayer.museum)) {
    for (const entry of legacyPlayer.museum) {
      const name = str((entry as Record<string, unknown>)?.name, '');
      const species = SPECIES_BY_NAME.get(name.toLowerCase());
      if (species) donated.add(species.id);
    }
  }

  const ownedFurniture: string[] = [];
  if (Array.isArray(legacyPlayer.ownedFurniture)) {
    for (const entry of legacyPlayer.ownedFurniture) {
      const name = str((entry as Record<string, unknown>)?.name, '');
      const def = FURNITURE_BY_NAME.get(name.toLowerCase());
      if (def) ownedFurniture.push(def.id);
    }
  }

  // The prototype placed furniture into abstract display slots. Lay them out on
  // a sensible grid in the new walkable cottage instead of dropping them.
  const placed = Array.isArray(legacyPlayer.placedFurniture)
    ? legacyPlayer.placedFurniture
        .map((entry, index: number) => {
          const name = str((entry as Record<string, unknown>)?.name, '');
          const def = FURNITURE_BY_NAME.get(name.toLowerCase());
          if (!def) return null;
          const col = index % 3;
          const row = Math.floor(index / 3);
          return {
            uid: uid('furn'),
            defId: def.id,
            x: -2 + col * 2,
            y: 0,
            z: -1.5 + row * 2,
            rotation: 0,
            room: 'main',
          };
        })
        .filter(Boolean)
    : [];

  const relationships: SaveDataV6['relationships'] = {};
  const legacyFriendship = (data.friendship ?? {}) as Record<string, unknown>;
  const legacyRequests = (data.requests ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(legacyFriendship)) {
    const id = name.toLowerCase();
    const req = legacyRequests[name] as Record<string, unknown> | undefined;
    const reqItemName = str(req?.name ?? (req?.item as Record<string, unknown>)?.name, '');
    const reqDef = reqItemName ? ITEMS_BY_NAME.get(reqItemName.toLowerCase()) : undefined;
    relationships[id] = {
      friendship: num(value, 0),
      lastTalkedDay: 0,
      giftsGiven: 0,
      ...(reqDef
        ? {
            request: {
              itemDefId: reqDef.id,
              reward: num(req?.reward, 150),
              done: bool(req?.done, false),
              day: num(data.day, 1),
            },
          }
        : {}),
    };
  }

  const legacyWorks = (data.townWorks ?? {}) as Record<string, unknown>;

  // Crops carried `planted`/`ageOffset` against the prototype's minute clock.
  const plots = Array.isArray(data.crops)
    ? data.crops.map((raw) => {
        const c = raw as Record<string, unknown>;
        const cropDef = ITEMS_BY_NAME.get(str(c.name, 'turnip').toLowerCase());
        const world = legacyToWorld(c.x, c.z ?? c.y);
        const elapsed = num(data.time, 480) + num(c.ageOffset, 0) - num(c.planted, 0);
        return {
          id: uid('plot'),
          x: world.x,
          z: world.z,
          cropId: cropDef?.id ?? 'crop.turnip',
          // The prototype matured a crop over 180 of its minutes; the new farm
          // uses a four-stage 960-minute cycle, so scale the elapsed time.
          growth: Math.max(0, Math.min(960, (elapsed / 180) * 960)),
          watered: false,
          wateredOnDay: 0,
          tilled: true,
        };
      })
    : [];

  const gardens = Array.isArray(data.gardens)
    ? data.gardens.map((raw) => {
        const g = raw as Record<string, unknown>;
        const world = legacyToWorld(g.x, g.z ?? g.y);
        return { x: world.x, z: world.z, color: str(g.color, '#f4b5c7') };
      })
    : [];

  const legacyStyleRoof = str(legacyHouseStyle.roof, '#537c96');
  const styleId =
    legacyStyleRoof === '#b0553f'
      ? 'style.orchardRed'
      : legacyStyleRoof === '#4f6b45'
        ? 'style.grovePine'
        : 'style.harbourBlue';

  // Deliberately still a v5 blob: `migrate` runs the chain, and v5→v6 is the
  // next link. Writing v6 here would mean maintaining two copies of every
  // future field addition.
  const migrated: LegacyV5 = {
    version: 5,
    slot: num(data.slot, 1),
    savedAt: Date.now(),
    playtimeSeconds: 0,
    clock: {
      day: Math.max(1, num(data.day, 1)),
      minutes: Math.max(0, Math.min(1439, Math.round(num(data.time, 480)))),
    },
    weather: {
      kind: (str(legacyWeather.type, 'Clear').toLowerCase() as SaveDataV6['weather']['kind']) ?? 'clear',
      remaining: 240,
    },
    player: {
      position: { x: pos.x, y: 0, z: pos.z },
      facing: 0,
      coins: num(legacyPlayer.coins, 250),
      look: convertLegacyLook(legacyPlayer.look),
      inventory,
      bagLevel: num(legacyPlayer.bagLevel, 0),
      materials: {
        wood: num(legacyMaterials.wood, 2),
        stone: num(legacyMaterials.stone, 2),
        fiber: num(legacyMaterials.fiber, 2),
      },
      seeds: num(legacyPlayer.seeds, 3),
      toolLevels: {
        rod: num(legacyTools.rod, 1),
        net: num(legacyTools.net, 1),
        shovel: num(legacyTools.shovel, 1),
        // Tools that did not exist in the prototype start at level 1.
        axe: 1,
        wateringCan: 1,
      },
      stats: {
        totalCaught: num(legacyPlayer.totalCaught, 0),
        totalSold: num(legacyPlayer.totalSold, 0),
        harvested: num(legacyPlayer.harvested, 0),
        flowersPlanted: num(legacyPlayer.flowersPlanted, 0),
        cooked: num(data.cooked, 0),
        records: {},
      },
    },
    museum: { donated: [...donated] },
    home: {
      level: Math.max(1, num(legacyPlayer.homeLevel, 1)),
      styleId,
      // The prototype had no shop for exteriors, so whatever the island is
      // wearing is the one style the player carries over as owned.
      ownedStyles: [styleId],
      ownedFurniture,
      placed: placed as SaveDataV6['home']['placed'],
    },
    farm: { plots },
    world: {
      gardens,
      gatherables: [],
      townWorks: {
        bridge: bool(legacyWorks.bridge, false),
        stairs: bool(legacyWorks.stairs, false),
        lighthouse: bool(legacyWorks.lighthouse, false),
      },
    },
    quests: {
      activeId: str(legacyQuest.id, 'museum'),
      progress: num(legacyQuest.progress, 0),
      issuedDay: Math.max(1, num(data.day, 1)),
      completedIds: [],
    },
    relationships,
    story: { stage: Math.max(0, Math.min(4, num(data.storyStage, 0))) },
    settings: { ...DEFAULT_SETTINGS, sfxVolume: bool(data.soundOn, true) ? DEFAULT_SETTINGS.sfxVolume : 0 },
  };

  return migrated as unknown as Record<string, unknown>;
};

/**
 * v5 → v6: the Secret Orchard's gate.
 *
 * Shut for everyone, including islands that have already finished the story —
 * the gate is a place to walk to and a thing to open, and handing it over
 * already open would take that away from a returning player.
 */
const migrate5to6: Migration = (data) => {
  const world = (data.world ?? {}) as Record<string, unknown>;
  return {
    ...data,
    version: 6,
    world: { ...world, orchardOpen: bool(world.orchardOpen, false) },
  };
};

/**
 * Migrations keyed by the version they upgrade *from*. Running them in sequence
 * takes any historical save up to SAVE_VERSION.
 */
export const MIGRATIONS: Record<number, Migration> = {
  4: migrate4to5,
  5: migrate5to6,
};

export interface MigrationResult {
  data: SaveDataV6;
  migratedFrom: number | null;
}

/** Detects the version of an unknown blob, defaulting to the prototype's v4 shape. */
export function detectVersion(data: AnySaveData): number {
  const v = (data as Record<string, unknown>).version;
  if (typeof v === 'number') return v;
  // The prototype never wrote a version field; its snapshot always had `player`
  // alongside a top-level `time`, which nothing newer does.
  if ('player' in data && 'time' in data) return 4;
  return SAVE_VERSION;
}

/**
 * Throws unless `data` has the fields `Game.applySave` dereferences.
 *
 * `detectVersion` has to guess for blobs with no version field, so an empty or
 * truncated record can reach here claiming to be current. Failing loudly keeps
 * that out of `applySave`, where the first `data.clock.day` would throw from
 * inside the frame loop instead of from a read the caller already guards.
 */
function assertCurrent(data: AnySaveData): asserts data is SaveDataV6 {
  const d = data as Record<string, unknown>;
  const required = ['clock', 'player', 'museum', 'home', 'farm', 'world', 'quests', 'relationships', 'settings'];
  const missing = required.filter((key) => typeof d[key] !== 'object' || d[key] === null);
  if (missing.length > 0) {
    throw new Error(`Save is missing required section(s): ${missing.join(', ')}`);
  }
}

export function migrate(raw: AnySaveData): MigrationResult {
  const from = detectVersion(raw);
  if (from > SAVE_VERSION) {
    // A save written by a newer build. Refusing beats silently loading fields
    // this build does not understand.
    throw new Error(`Save version ${from} is newer than this build supports (${SAVE_VERSION})`);
  }
  if (from === SAVE_VERSION) {
    assertCurrent(raw);
    return { data: raw, migratedFrom: null };
  }

  let data = raw as Record<string, unknown>;
  let version = from;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(`No migration registered from save version ${version}`);
    }
    data = step(data);
    version = detectVersion(data);
    // Guard against a migration that forgets to advance the version.
    if (version <= from && version < SAVE_VERSION) {
      throw new Error(`Migration from version ${from} did not advance the schema version`);
    }
  }

  const migrated = data as AnySaveData;
  assertCurrent(migrated);
  return { data: migrated, migratedFrom: from };
}
