import { Box3, Color, Group, Vector3 } from 'three';
import type { AssetManager } from '@/assets/AssetManager';
import { setAssets } from '@/assets/registry';
import { AudioSystem } from '@/audio/AudioSystem';
import { EventBus } from './EventBus';
import { InputSystem } from '@/input/InputSystem';
import { CameraRig } from '@/rendering/CameraRig';
import { LightingRig } from '@/rendering/LightingRig';
import { ParticleSystem } from '@/rendering/Particles';
import { Renderer, type QualityLevel } from '@/rendering/Renderer';
import { Sky } from '@/rendering/Sky';
import { UnderwaterFX } from '@/rendering/UnderwaterFX';
import { WeatherFX } from '@/rendering/WeatherFX';
import { registerShaderChunks, updateSharedUniforms } from '@/rendering/materials';
import { SEASON_TINT } from '@/rendering/palette';
import { TimeSystem } from '@/time/TimeSystem';
import { WeatherSystem } from '@/time/WeatherSystem';
import { Terrain } from '@/world/Terrain';
import { Water } from '@/world/Water';
import { Foliage } from '@/world/Foliage';
import { Props } from '@/world/Props';
import { Scatter } from '@/world/Scatter';
import { Wildlife } from '@/world/Wildlife';
import { Buildings, type BuildingId } from '@/world/Buildings';
import {
  createHomeInterior,
  createMuseumInterior,
  createShopInterior,
  createTownHallInterior,
  createVillagerHomeInterior,
  homeLayoutFor,
  type InteriorScene,
} from '@/world/Interiors';
import { ISLAND_HALF, LANDMARKS, SEA_LEVEL, terrainHeight, walkHeight, waterDepth } from '@/world/heightfield';
import { Landscaping } from '@/world/Landscaping';
import { CreekWater } from '@/world/CreekWater';
import {
  isInRegion,
  isNamedPlace,
  regionAt,
  regionLabel,
  speciesBelongsIn,
  REGIONS_BY_ID,
  type RegionId,
} from '@/world/regions';
import { drawIslandMap } from '@/world/Minimap';
import { DIVE_MIN_DEPTH, Player } from '@/player/Player';
import { TOOLS, type ToolId } from '@/player/Tools';
import { VillagerManager } from '@/npc/VillagerManager';
import { Inventory, rollSize } from '@/inventory/Inventory';
import { Museum } from '@/museum/Museum';
import { FishSchools, ReefLife, type ReefCollectible } from '@/fishing/FishSchools';
import { FishingSystem } from '@/fishing/FishingSystem';
import { Farm } from '@/farming/Farm';
import { DropSystem } from '@/gathering/DropSystem';
import { Insects } from '@/gathering/Insects';
import { InteractionSystem } from '@/interactions/InteractionSystem';
import type { InteractionOption } from '@/interactions/types';
import { QuestSystem } from '@/quests/QuestSystem';
import { Relationships } from '@/relationships/Relationships';
import { ShopSystem } from '@/shops/ShopSystem';
import { HomeFurnishing } from '@/housing/HomeFurnishing';
import { SaveSystem, createNewSave } from '@/save/SaveSystem';
import { SAVE_VERSION, type SaveDataV7 } from '@/save/schema';
import { DEFAULT_LOOK, type CharacterLook } from '@/data/clothing';
import { FURNITURE_BY_ID, HOUSE_STYLES_BY_ID } from '@/data/furniture';
import { CRAFTING, RECIPES } from '@/data/recipes';
import { PUBLIC_WORKS } from '@/data/quests';
import { VILLAGERS, VILLAGERS_BY_ID } from '@/data/villagers';
import { ALL_SPECIES, BUGS, FOSSILS, SEA_CREATURES, SPECIES_BY_ID } from '@/data/species';
import { DECOR, DECOR_BY_ID } from '@/data/decor';
import { getItemDef } from '@/data/items';
import type { SpeciesDef } from '@/items/types';
import { iconFor } from '@/items/ItemIcons';
import { UIRoot } from '@/ui/UIRoot';
import { HUD } from '@/ui/HUD';
import { Dialogue } from '@/ui/Dialogue';
import { CatchCard } from '@/ui/CatchCard';
import { TitleScreen } from '@/ui/TitleScreen';
import { TouchControls } from '@/ui/TouchControls';
import { playerPortrait, villagerPortrait } from '@/ui/portraits';
import {
  openCooking,
  openCrafting,
  openHome,
  openInventory,
  openJournal,
  openMap,
  openMuseum,
  openSettings,
  openShop,
  openTownHall,
  openWardrobe,
  type PanelContext,
} from '@/ui/panels';
import { clamp01 } from '@/util/math';
import { disposeObject } from '@/util/three';

/** Interiors are built far from the island so both can exist in one scene. */
const INTERIOR_ORIGIN = new Vector3(1000, 0, 0);

/** How far in front of the player the net reaches, in metres. */
const NET_REACH = 2.6;
/** Half the width of the swing's arc. A little over a quarter turn either way. */
const NET_HALF_ANGLE = Math.PI * 0.42;
/** What the prompt calls an insect before it has been caught and named. */
const INSECT_WORD: Record<string, string> = {
  butterfly: 'Butterfly',
  beetle: 'Beetle',
  dragonfly: 'Dragonfly',
};

/**
 * An interior's anchors in world space. Rooms are modelled around their own
 * origin and the root that holds them is offset, so anything outside the room
 * — the interaction prompts, the villagers standing in it — has to add that
 * offset back to compare against the player.
 */
function worldAnchors(interior: InteriorScene): Record<string, Vector3> {
  const out: Record<string, Vector3> = {};
  for (const [key, local] of Object.entries(interior.anchors)) {
    out[key] = new Vector3(local.x + INTERIOR_ORIGIN.x, local.y + INTERIOR_ORIGIN.y, local.z + INTERIOR_ORIGIN.z);
  }
  return out;
}

type Mode = 'title' | 'exterior' | 'interior' | 'decorating' | 'building';

export class Game {
  readonly bus = new EventBus();
  readonly renderer: Renderer;
  readonly input: InputSystem;
  readonly audio = new AudioSystem();
  readonly save: SaveSystem;

  private sky = new Sky();
  private lighting: LightingRig;
  private cameraRig: CameraRig;
  private particles = new ParticleSystem();
  private weatherFX = new WeatherFX();
  private underwaterFX = new UnderwaterFX();

  readonly time: TimeSystem;
  readonly weather: WeatherSystem;

  private exteriorRoot = new Group();
  private interiorRoot = new Group();
  private terrain!: Terrain;
  private water!: Water;
  private creek!: CreekWater;
  private foliage!: Foliage;
  private props!: Props;
  private scatter!: Scatter;
  private wildlife!: Wildlife;
  private buildings!: Buildings;
  private fishSchools!: FishSchools;
  private reef!: ReefLife;
  private insects!: Insects;
  private farm!: Farm;
  private drops!: DropSystem;
  private villagers!: VillagerManager;

  private player!: Player;
  readonly inventory: Inventory;
  readonly museum: Museum;
  readonly relationships: Relationships;
  readonly quests: QuestSystem;
  readonly shop = new ShopSystem();
  readonly furnishing: HomeFurnishing;
  readonly landscaping: Landscaping;
  private fishing!: FishingSystem;
  private interactions: InteractionSystem;

  readonly uiRoot: UIRoot;
  private hud: HUD;
  private dialogue: Dialogue;
  private catchCard: CatchCard;
  private title!: TitleScreen;

  private mode: Mode = 'title';
  private activeInterior: InteriorScene | null = null;
  private activeBuildingId: BuildingId | null = null;

  // --- Player-owned state not held by a subsystem ---------------------------
  private coins = 250;
  private look: CharacterLook = { ...DEFAULT_LOOK };
  private materials = { wood: 2, stone: 2, fiber: 2 };
  private seeds = 3;
  private homeLevel = 1;
  private houseStyleId = 'style.harbourBlue';
  private ownedFurniture: string[] = [];
  /** Paid exterior colourways the player has bought; free ones need no entry. */
  private ownedStyles: string[] = [];
  private stats = { totalCaught: 0, totalSold: 0, harvested: 0, flowersPlanted: 0, cooked: 0, records: {} as Record<string, number> };
  private slot = 1;
  private playtime = 0;
  private lastTownRating = 1;
  private lastSeason = 'Spring';
  private lastMinutes = 0;

  private elapsed = 0;
  private running = false;
  private lastFrame = 0;

  /**
   * How submerged the presentation is, 0–1. Eased rather than switched, so
   * going under and coming up are moments rather than cuts, and so a dive that
   * ends because the air ran out still fades back to the island.
   */
  private underwater = 0;
  /**
   * Catch cards held back for the surface. The creatures themselves are already
   * in the bag; only the reveal waits, which is what makes going up a moment
   * rather than a formality without putting the catch itself at risk.
   */
  private pendingDiveCards: (() => void)[] = [];

  /**
   * `assets` is optional and may be half-loaded: every system falls back to its
   * generated art for anything the kits did not supply, so the game boots with
   * no kits at all.
   */
  constructor(private container: HTMLElement, private assets?: AssetManager) {
    registerShaderChunks();
    // Every system built below may reach for kit geometry through the registry.
    setAssets(assets);

    this.renderer = new Renderer(container);
    this.input = new InputSystem(window);
    this.save = new SaveSystem(this.bus);

    this.time = new TimeSystem(this.bus);
    this.weather = new WeatherSystem(this.bus);

    this.lighting = new LightingRig(this.renderer.scene, this.sky);
    this.cameraRig = new CameraRig(this.renderer.camera, this.renderer.scene);

    this.inventory = new Inventory(this.bus);
    this.museum = new Museum(this.bus);
    this.relationships = new Relationships(this.bus);
    this.quests = new QuestSystem(this.bus);
    this.furnishing = new HomeFurnishing(this.bus);
    this.landscaping = new Landscaping(this.bus);
    this.interactions = new InteractionSystem(this.bus);

    this.uiRoot = new UIRoot(container, this.bus, this.input);
    this.hud = new HUD(this.uiRoot, this.bus, this.input);
    this.dialogue = new Dialogue(this.uiRoot, this.bus, this.input);
    this.catchCard = new CatchCard(this.uiRoot);

    this.buildWorld();
    this.wireEvents();

    new TouchControls(this.uiRoot, this.input);
    this.title = new TitleScreen(container, {
      summaries: () => this.save.summaries(),
      onContinue: (slot) => void this.beginGame(slot, false),
      onNew: (slot) => void this.beginGame(slot, true),
      onErase: (slot) => this.save.erase(slot),
    });

    this.hud.setVisible(false);
    this.presentTitleVista();
  }

  // --- Construction --------------------------------------------------------

  private buildWorld(): void {
    const scene = this.renderer.scene;
    scene.add(this.exteriorRoot, this.interiorRoot);
    this.exteriorRoot.name = 'Exterior';
    this.interiorRoot.name = 'Interior';
    this.interiorRoot.position.copy(INTERIOR_ORIGIN);
    this.interiorRoot.visible = false;

    // 380 divisions puts a vertex every half metre, which is what stops the
    // waterline stepping across the beach where the flat sea meets the mesh.
    this.terrain = new Terrain({ resolution: 380 });
    this.water = new Water();
    this.creek = new CreekWater();
    this.foliage = new Foliage(this.renderer.profile.foliageDensity, this.assets);
    this.props = new Props();
    this.scatter = new Scatter(this.foliage.trees, this.renderer.profile.foliageDensity);
    this.wildlife = new Wildlife();
    this.buildings = new Buildings();
    this.fishSchools = new FishSchools();
    this.reef = new ReefLife(SEA_CREATURES);
    this.insects = new Insects();
    this.farm = new Farm(this.bus);
    this.drops = new DropSystem(this.bus);

    this.exteriorRoot.add(
      this.terrain.mesh,
      this.water.mesh,
      this.creek.mesh,
      this.foliage.group,
      this.props.group,
      this.scatter.group,
      this.wildlife.group,
      this.buildings.group,
      this.fishSchools.group,
      this.reef.group,
      this.insects.group,
      this.landscaping.group,
      this.farm.group,
      this.drops.group,
    );

    // Navigation avoids buildings and solid props.
    const obstacles = [
      ...this.buildings.colliders.map((c) => ({ x: c.x, z: c.z, radius: Math.max(c.halfW, c.halfD) + 0.8 })),
      ...this.props.colliders,
    ];
    const doors = new Map<BuildingId, { doorway: Vector3; facing: number }>();
    for (const [id, building] of this.buildings.instances) {
      doors.set(id, { doorway: building.doorway, facing: building.doorFacing });
    }
    this.villagers = new VillagerManager(this.bus, obstacles, doors);
    // The same list keeps a bench off somebody's doorstep. Landscaping is built
    // with the rest of the game systems, before there is a world to consult.
    this.landscaping.obstacles = obstacles;
    // Villagers sit outside both roots: a villager can be in the room the
    // player is standing in, and `exteriorRoot` is hidden wholesale indoors.
    // Each one's own visibility says which world they are currently in.
    scene.add(this.villagers.group);

    this.player = new Player(this.bus, this.look);
    scene.add(this.player.group);

    this.fishing = new FishingSystem(this.bus, this.particles, this.fishSchools);
    scene.add(this.fishing.group);

    scene.add(this.particles.normalPoints, this.particles.additivePoints, this.weatherFX.group);
    scene.add(this.underwaterFX.group);
    this.interiorRoot.add(this.furnishing.group);

    this.cameraRig.bounds = new Box3(
      new Vector3(-ISLAND_HALF + 6, -20, -ISLAND_HALF + 6),
      new Vector3(ISLAND_HALF - 6, 60, ISLAND_HALF - 6),
    );
    this.cameraRig.occluders = [...this.buildings.occluders, ...this.foliage.occluders];

    this.terrain.applySeason('Spring');
    this.foliage.applySeason('Spring');
    this.scatter.applySeason('Spring');
  }

  private wireEvents(): void {
    this.bus.on('audio:sfx', ({ id, volume, rate }) => this.audio.playSound(id, { volume, rate }));
    this.bus.on('audio:music', ({ id }) => this.audio.playMusic(id));

    this.bus.on('ui:catchCard', (payload) => this.catchCard.show(payload));

    // The bite is the one moment in fishing that has to be unmissable.
    this.bus.on('fishing:state', ({ state }) => {
      if (state === 'casting') this.cameraRig.setPreset('fishing');
      else if (state === 'idle') this.cameraRig.setPreset(this.mode === 'exterior' ? 'exterior' : 'interior');
      if (state === 'biting') {
        this.player.emoteBubble('exclaim', 1.0);
        this.cameraRig.shake(0.08);
      } else if (state === 'nibbling') {
        this.player.emoteBubble('question', 0.8);
      } else if (state === 'landing') {
        this.player.emoteBubble('fish', 1.4);
      }
    });

    this.bus.on('inventory:full', () => {
      this.uiRoot.toast('Your bag is full. Sell or store something.', 'warn');
      this.bus.emit('audio:sfx', { id: 'ui.error' });
    });

    this.bus.on('quest:completed', ({ title, reward }) => {
      this.addCoins(reward);
      this.uiRoot.toast(`${title} — complete! +${reward} shells`, 'good');
    });

    this.bus.on('time:day', ({ day }) => this.onNewDay(day));

    this.bus.on('friendship:changed', () => this.save.markDirty());
    this.bus.on('item:gained', () => this.save.markDirty());

    // The first gesture anywhere unlocks audio, as browsers require.
    const unlock = () => {
      this.audio.unlock();
      this.applyVolumes();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private settings = {
    masterVolume: 0.8,
    musicVolume: 0.55,
    sfxVolume: 0.85,
    ambienceVolume: 0.7,
    quality: 'high' as QualityLevel,
    autoQuality: true,
    cameraShake: true,
  };

  private applyVolumes(): void {
    this.audio.setVolumes({
      master: this.settings.masterVolume,
      music: this.settings.musicVolume,
      sfx: this.settings.sfxVolume,
      ui: this.settings.sfxVolume,
      ambience: this.settings.ambienceVolume,
    });
  }

  // --- Lifecycle -----------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    // Clamp so a backgrounded tab does not fast-forward the island, and guard
    // against a non-monotonic clock producing a negative step.
    const dt = Math.max(0, Math.min(0.05, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.elapsed += dt;

    this.update(dt);
    this.renderer.render(dt);
    this.input.endFrame();

    requestAnimationFrame(this.frame);
  };

  /** Frames the island attractively behind the title card. */
  private presentTitleVista(): void {
    this.time.load(1, 17 * 60 + 20);
    this.weather.set('clear', 600, true);
    this.cameraRig.setPreset('vista', true);
    this.cameraRig.snapTo(new Vector3(0, 4, 8), Math.PI * 0.75);
    this.player.teleport(0, 6, Math.PI);
    this.player.group.visible = false;
    this.resetDiveState();
    this.villagers.snapToSchedule(17);
    this.audio.playMusic('music.title');
  }

  /**
   * Puts the dive back to rest without playing the surfacing transition.
   *
   * Quitting to the title teleports the player, which ends a dive silently, so
   * `updateDiving` never sees the change and the next session inherits the
   * leftovers: the camera's underwater ceiling, the blue-green blend over the
   * title vista, and — worst — the deferred catch cards, which would otherwise
   * be revealed on whichever island is loaded next.
   */
  private resetDiveState(): void {
    this.wasDiving = false;
    this.pendingDiveCards = [];
    this.cancelDiveCards();
    this.underwater = 0;
    this.cameraRig.terrainClamp = true;
    this.cameraRig.heightCeiling = null;
    this.hud.hideAirMeter();
  }

  private async beginGame(slot: number, fresh: boolean): Promise<void> {
    this.slot = slot;
    const record = fresh ? null : this.save.read(slot);
    const data = record?.data ?? createNewSave(slot);
    if (fresh) this.save.erase(slot);

    this.applySave(data);
    this.title.hide();
    this.audio.unlock();
    this.applyVolumes();

    await this.uiRoot.transition(async () => {
      this.mode = 'exterior';
      this.player.group.visible = true;
      this.hud.setVisible(true);
      this.cameraRig.setPreset('exterior', true);
      this.cameraRig.snapTo(this.player.position, this.player.facing + Math.PI);
      this.villagers.snapToSchedule(this.time.hour);
      this.registerExteriorInteractions();
    }, 520, 620);

    this.uiRoot.showLocation('Cozy Cove', record?.migratedFrom ? 'Your island, carried forward' : 'Town Square');
    if (record?.migratedFrom) {
      this.uiRoot.toast('Older save upgraded — everything came across.', 'good');
    }
    this.updateMusic();
  }

  // --- Save ----------------------------------------------------------------

  private applySave(data: SaveDataV7): void {
    this.time.load(data.clock.day, data.clock.minutes);
    // The elapsed-minute counter is absolute (day * 1440 + minutes); seeding it
    // with the time of day alone made the first frame after a load advance the
    // clock by weeks, re-rolling the weather and instantly maturing every crop.
    this.lastMinutes = this.time.day * 1440 + this.time.minutes;
    this.weather.set(data.weather.kind, data.weather.remaining, true);

    this.coins = data.player.coins;
    this.look = { ...DEFAULT_LOOK, ...data.player.look };
    this.materials = { ...data.player.materials };
    this.seeds = data.player.seeds;
    this.stats = { ...this.stats, ...data.player.stats, records: { ...data.player.stats.records } };
    this.playtime = data.playtimeSeconds;

    this.player.setLook(this.look);
    this.player.toolLevels = {
      none: 1,
      rod: data.player.toolLevels.rod,
      net: data.player.toolLevels.net,
      shovel: data.player.toolLevels.shovel,
      axe: data.player.toolLevels.axe,
      wateringCan: data.player.toolLevels.wateringCan,
    };
    this.player.setTool('rod', false);
    this.player.teleport(data.player.position.x, data.player.position.z, data.player.facing);

    this.inventory.load(data.player.inventory, data.player.bagLevel);
    this.museum.load(data.museum.donated);
    this.relationships.load(data.relationships);
    this.quests.load(data.quests, data.story.stage);

    this.homeLevel = data.home.level;
    this.houseStyleId = data.home.styleId;
    this.ownedFurniture = [...data.home.ownedFurniture];
    // Older v5 blobs from before styles were tracked: honour the applied style.
    this.ownedStyles = [...(data.home.ownedStyles ?? [data.home.styleId])];
    this.buildings.applyHouseStyle(this.houseStyleId);

    this.farm.load(data.farm.plots);
    for (const entry of data.world.gatherables) {
      const node = this.props.gatherNodes.find((n) => n.id === entry.id);
      if (node) node.harvestedOnDay = entry.harvestedOnDay;
    }
    this.props.refreshNodes(this.time.day);
    this.foliage.refreshFruit(this.time.day);
    this.townWorks = { ...data.world.townWorks };
    this.props.setOrchardOpen(data.world.orchardOpen, true);
    // Banner state belongs to the island being loaded, not to the session. Two
    // slots on the same day in the same place would otherwise inherit each
    // other's suppressed arrivals.
    this.currentRegion = regionAt(data.player.position.x, data.player.position.z);
    this.regionSettleTimer = 0;
    this.pendingRegion = this.currentRegion;
    this.announcedOnDay.clear();
    this.landscaping.load(data.world.decor);
    this.reef.load(data.world.reef, this.time.day);

    Object.assign(this.settings, {
      masterVolume: data.settings.masterVolume,
      musicVolume: data.settings.musicVolume,
      sfxVolume: data.settings.sfxVolume,
      ambienceVolume: data.settings.ambienceVolume,
      quality: data.settings.quality,
      cameraShake: data.settings.cameraShake,
    });
    this.cameraRig.shakeEnabled = this.settings.cameraShake;
    // The renderer keeps its startup profile unless it is told; without this a
    // player who chose "low" and reloaded silently runs at the default.
    this.renderer.autoQuality = this.settings.autoQuality;
    this.renderer.applyQuality(this.settings.quality);

    // Furniture needs the home interior's bounds, which depend on the level.
    const layout = homeLayoutFor(this.homeLevel);
    this.furnishing.setBounds({
      minX: -layout.gridHalfW + 0.6,
      maxX: layout.gridHalfW - 0.6,
      minZ: -layout.gridHalfD + 0.6,
      maxZ: layout.gridHalfD - 1.2,
    });
    this.furnishing.load(data.home.placed);

    const season = this.time.season;
    this.terrain.applySeason(season);
    this.foliage.applySeason(season);
    this.scatter.applySeason(season);
    this.lastSeason = season;
  }

  private townWorks = { bridge: false, stairs: false, lighthouse: false };
  /** Where the player is standing, for the region banner. */
  private currentRegion: RegionId = 'town';
  /** The region being settled into, which is not yet `currentRegion`. */
  private pendingRegion: RegionId = 'town';
  private regionSettleTimer = 0;
  /** The day each region was last announced, so arriving is once a day rather than once ever. */
  private announcedOnDay = new Map<RegionId, number>();

  snapshot(): SaveDataV7 {
    return {
      version: SAVE_VERSION,
      slot: this.slot,
      savedAt: Date.now(),
      playtimeSeconds: Math.round(this.playtime),
      clock: { day: this.time.day, minutes: Math.round(this.time.minutes) },
      weather: { kind: this.weather.kind, remaining: this.weather.remaining },
      player: {
        position: { x: this.player.position.x, y: 0, z: this.player.position.z },
        facing: this.player.facing,
        coins: this.coins,
        look: { ...this.look },
        inventory: this.inventory.serialize(),
        bagLevel: this.inventory.bagLevel,
        materials: { ...this.materials },
        seeds: this.seeds,
        toolLevels: {
          rod: this.player.toolLevels.rod,
          net: this.player.toolLevels.net,
          shovel: this.player.toolLevels.shovel,
          axe: this.player.toolLevels.axe,
          wateringCan: this.player.toolLevels.wateringCan,
        },
        stats: { ...this.stats, records: { ...this.stats.records } },
      },
      museum: { donated: this.museum.serialize() },
      home: {
        level: this.homeLevel,
        styleId: this.houseStyleId,
        ownedStyles: [...this.ownedStyles],
        ownedFurniture: [...this.ownedFurniture],
        placed: this.furnishing.serialize(),
      },
      farm: { plots: this.farm.serialize() },
      world: {
        // A projection of the flower beds in `decor`, which is what actually
        // holds them. Written because this is the shape the prototype's saves
        // carry their gardens in, and the migration reads it back.
        gardens: this.landscaping.placed
          .filter((p) => p.def.kind === 'flower')
          .map((p) => ({ x: p.x, z: p.z, color: p.tint ?? '#f4b5c7' })),
        decor: this.landscaping.serialize(),
        reef: this.reef.serialize(),
        gatherables: this.props.gatherNodes
          .filter((n) => n.harvestedOnDay > 0)
          .map((n) => ({ id: n.id, harvestedOnDay: n.harvestedOnDay })),
        townWorks: { ...this.townWorks },
        orchardOpen: this.props.orchardGate.isOpen,
      },
      quests: this.quests.serialize(),
      relationships: this.relationships.serialize(),
      story: { stage: this.quests.storyStage },
      settings: {
        masterVolume: this.settings.masterVolume,
        musicVolume: this.settings.musicVolume,
        sfxVolume: this.settings.sfxVolume,
        ambienceVolume: this.settings.ambienceVolume,
        quality: this.settings.quality,
        cameraShake: this.settings.cameraShake,
        invertCameraX: false,
      },
    };
  }

  // --- Main loop -----------------------------------------------------------

  private update(dt: number): void {
    this.input.update(dt);
    this.audio.update(dt);
    this.catchCard.update(dt);
    this.dialogue.update(dt);
    this.uiRoot.update();

    if (this.mode === 'title') {
      this.updateWorld(dt, false);
      return;
    }

    this.playtime += dt;
    const paused = this.uiRoot.pausesWorld;

    if (!paused) {
      this.time.update(dt);
      const minutesNow = this.time.minutes + this.time.day * 1440;
      const lastAbsolute = this.lastMinutes;
      const delta = minutesNow - lastAbsolute;
      if (delta > 0) {
        this.weather.tickMinutes(delta, this.time.season);
        this.farm.advance(delta, this.time.day);
      }
      this.lastMinutes = minutesNow;
    }
    this.weather.update(dt);

    this.handleGlobalInput();
    if (!paused && !this.dialogue.isOpen) this.handleGameplayInput(dt);

    this.updatePlayer(dt, paused);
    if (this.mode === 'exterior') this.updateRegionBanner(dt);
    this.updateWorld(dt, !paused);
    this.updateInteractions(dt, paused);
    this.updateAudioMix();
    this.updateHud();

    this.save.tick(dt, () => this.snapshot());
  }

  /**
   * Announces a region the first time the player walks into it.
   *
   * A hysteresis band rather than a bare comparison: the boundaries are circles
   * and the creek is a few metres wide, so a player walking a boundary would
   * otherwise be shouted at once a second.
   */
  private updateRegionBanner(dt: number): void {
    const here = regionAt(this.player.position.x, this.player.position.z);
    if (here === this.currentRegion) {
      this.pendingRegion = here;
      this.regionSettleTimer = 0;
      return;
    }
    // The timer measures continuous time in *this* candidate, not total time
    // away from the last one. Someone crossing three regions in a second would
    // otherwise have the third announced the instant they stepped into it.
    if (here !== this.pendingRegion) {
      this.pendingRegion = here;
      this.regionSettleTimer = 0;
    }
    this.regionSettleTimer += dt;
    if (this.regionSettleTimer < 1.1) return;

    this.regionSettleTimer = 0;
    this.currentRegion = here;
    // Only the places worth naming, per the region table — the same flag the
    // map pins read, so the two can never disagree about what counts.
    if (!isNamedPlace(here)) return;
    if (this.announcedOnDay.get(here) === this.time.day) return;
    this.announcedOnDay.set(here, this.time.day);
    this.uiRoot.showLocation(regionLabel(here), REGIONS_BY_ID.get(here)?.blurb ?? '');
  }

  private updatePlayer(dt: number, paused: boolean): void {
    const constraints = this.movementConstraints();
    let moveX = 0;
    let moveZ = 0;

    if (!paused && !this.dialogue.isOpen && this.mode !== 'decorating') {
      // Camera-relative movement: pushing up always walks away from the
      // camera, whichever way the player has orbited it.
      const yaw = this.cameraRig.yaw;
      const forwardX = -Math.sin(yaw);
      const forwardZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const ix = this.input.move.x;
      // Input Y is negative when pushing up, which is "forward".
      const iForward = -this.input.move.y;
      moveX = rightX * ix + forwardX * iForward;
      moveZ = rightZ * ix + forwardZ * iForward;
    }

    const running = this.input.isDown('run') && this.player.state === 'free';
    this.player.update(paused ? 0 : dt, moveX, moveZ, running, constraints);

    // Between the two on purpose: the dive's preset and its ceiling are decided
    // by the step that just ran, and have to be in place before the camera
    // reads them, or the frame the player goes under is framed as though they
    // had not.
    if (this.mode === 'exterior') this.updateDiving(paused);

    // Camera
    const orbit = -this.input.look.x + (this.input.isDown('cameraLeft') ? -1 : 0) + (this.input.isDown('cameraRight') ? 1 : 0);
    if (this.input.justPressed('zoomIn')) this.cameraRig.nudgeZoom(-0.16);
    if (this.input.justPressed('zoomOut')) this.cameraRig.nudgeZoom(0.16);
    this.cameraRig.update(dt, this.player.position, this.player.velocity, orbit);
  }

  /**
   * Everything that follows the player being under water: the camera, the air
   * gauge, and what happens when the breath runs out.
   *
   * The dive itself lives on the player; this is the game's side of it, and it
   * runs every frame rather than on a state change because the camera has to
   * track the surface continuously as the diver crosses the shelf.
   */
  private updateDiving(paused: boolean): void {
    const diving = this.player.diving;

    if (diving !== this.wasDiving) {
      this.wasDiving = diving;
      this.cameraRig.setPreset(diving ? 'diving' : 'exterior');
      this.cameraRig.terrainClamp = !diving;
      // Just under the surface: a boom that swings over the shallows would
      // otherwise lift the view out of the water mid-dive.
      this.cameraRig.heightCeiling = diving ? SEA_LEVEL - 0.5 : null;
      if (diving) this.pendingDiveCards = [];
      else this.resolveDiveCatches();
    }

    if (diving && !paused) {
      this.hud.showAirMeter();
      this.hud.updateAirMeter(this.player.airFraction);
    } else {
      this.hud.hideAirMeter();
    }

    if (this.player.consumeAirRanOut()) {
      this.player.emoteBubble('exclaim', 1.2);
      this.uiRoot.toast('Out of air — back to the surface.', 'warn');
    }
  }

  /** Reveals what the dive brought up, one card after another. */
  private resolveDiveCatches(): void {
    const cards = this.pendingDiveCards;
    this.pendingDiveCards = [];
    // The handles are kept because the reveal outlives the call: come up with
    // three creatures and the last card is still a second and a half away.
    // Quitting inside that window would otherwise drop it on the title screen,
    // or on whichever island is loaded next.
    cards.forEach((show, index) => {
      this.diveCardTimers.push(window.setTimeout(() => show(), index * 720));
    });
  }

  /** Reveals still waiting to fire, so a session boundary can call them off. */
  private diveCardTimers: number[] = [];

  /** Drops any catch card that has been scheduled but not yet shown. */
  private cancelDiveCards(): void {
    for (const timer of this.diveCardTimers) window.clearTimeout(timer);
    this.diveCardTimers = [];
  }

  /** Tracks the dive across frames so the camera only switches on the change. */
  private wasDiving = false;

  private movementConstraints() {
    if (this.mode === 'interior' || this.mode === 'decorating') {
      const interior = this.activeInterior;
      if (interior) {
        const b = interior.room.bounds;
        return {
          circles: [
            ...interior.colliders.map((c) => ({ x: c.x + INTERIOR_ORIGIN.x, z: c.z + INTERIOR_ORIGIN.z, radius: c.radius })),
            ...(interior.id === 'home'
              ? this.furnishing.colliders.map((c) => ({ x: c.x + INTERIOR_ORIGIN.x, z: c.z + INTERIOR_ORIGIN.z, radius: c.radius }))
              : []),
          ],
          boxes: [],
          bounds: {
            minX: b.minX + INTERIOR_ORIGIN.x,
            maxX: b.maxX + INTERIOR_ORIGIN.x,
            minZ: b.minZ + INTERIOR_ORIGIN.z,
            maxZ: b.maxZ + INTERIOR_ORIGIN.z,
          },
          fixedHeight: 0,
        };
      }
    }
    return {
      circles: [...this.props.colliders, ...this.landscaping.colliders],
      boxes: this.buildings.colliders,
      // The shelf is where the dive happens, so the player has to be able to
      // swim out onto it rather than stopping at waist depth.
      allowSwimming: true,
    };
  }

  private updateWorld(dt: number, advance: boolean): void {
    const time = this.time.snapshot();
    const weather = this.weather.current;
    const indoors = this.mode === 'interior' || this.mode === 'decorating';

    // Half a second either way: long enough to read as breaking the surface,
    // short enough that it is over before the player has swum anywhere.
    const submerged = this.player.diving ? 1 : 0;
    this.underwater += (submerged - this.underwater) * Math.min(1, dt * 4.5);
    if (Math.abs(this.underwater - submerged) < 0.004) this.underwater = submerged;

    const seasonTint = new Color(SEASON_TINT[time.season]?.grass ?? '#8ecb6a');
    updateSharedUniforms(this.elapsed, weather.wind, this.weather.wetness, seasonTint);

    const lightingOutput = this.lighting.update(
      time,
      weather,
      this.weather.lightningFlash,
      this.player.position,
      indoors,
      this.underwater,
    );
    this.lighting.setShadowQuality(this.renderer.profile);
    this.renderer.setGrade(lightingOutput);
    this.renderer.renderer.toneMappingExposure = lightingOutput.exposure;
    this.renderer.setBloom(lightingOutput.bloom);

    const camera = this.renderer.camera;
    this.sky.follow(camera.position.x, 0, camera.position.z);
    this.sky.update(this.elapsed);

    // Indoors the sky dome would show through the open ceiling, so swap it for
    // a plain backdrop and let the room read as a lit model. Under water the
    // dome is just as wrong: a bright blue sky behind a teal fog ramp reads as
    // a bug, so the backdrop becomes the water itself.
    const deepUnder = this.underwater > 0.55;
    this.sky.mesh.visible = !indoors && !deepUnder;
    if (indoors) this.renderer.renderer.setClearColor(0x1b2028, 1);
    else if (deepUnder) this.renderer.renderer.setClearColor(0x123f4c, 1);

    if (!indoors) {
      this.water.follow(camera.position.x, camera.position.z);
      this.water.update(
        this.elapsed,
        this.lighting.sun.position.clone().sub(this.player.position).normalize(),
        this.lighting.sun.color,
        new Color(this.sky.uniforms.uBottomColor.value as Color),
        weather.wind,
        0.3 + weather.wind * 0.7,
      );
      this.creek.update(
        this.elapsed,
        this.lighting.sun.position.clone().sub(this.player.position).normalize(),
        this.lighting.sun.color,
        new Color(this.sky.uniforms.uBottomColor.value as Color),
      );
      this.foliage.update(dt, this.player.position.x, this.player.position.z);
      this.updateAmbientEffects(dt, lightingOutput.darkness, weather.precipitation);
      this.foliage.setGrassDistance(this.renderer.profile.grassDistance);
      this.props.update(dt, lightingOutput.darkness, this.elapsed, (x, z) => this.water.surfaceHeight(x, z));
      this.wildlife.update(dt, 1 - lightingOutput.darkness, weather.precipitation, time.season, weather.wind, camera.position.x, camera.position.z);
      this.buildings.update(dt, lightingOutput.darkness, this.townWorks.lighthouse, this.time.hour);
      this.fishSchools.update(dt, this.elapsed, camera.position.x, camera.position.z);
      this.reef.update(dt, this.elapsed, this.time.hour, this.time.day, camera.position.x, camera.position.z);
      this.insects.update(dt, this.elapsed, {
        playerX: this.player.position.x,
        playerZ: this.player.position.z,
        playerSpeed: Math.hypot(this.player.velocity.x, this.player.velocity.z),
        candidatesAt: (x, z) => (this.isSealed(x, z) ? [] : this.bugsActiveIn(regionAt(x, z), this.time.hour)),
      });
      this.landscaping.setLightLevel(lightingOutput.darkness);
      this.farm.update(dt);
      this.drops.update(dt, this.player.position, (x, z) => walkHeight(x, z));
    } else {
      this.updateInteriorWalls(camera.position);
      this.activeInterior?.update?.(dt, this.elapsed);
      this.furnishing.setLightLevel(clamp01(lightingOutput.darkness * 1.6 + 0.35));
      this.drops.update(dt, this.player.position, () => 0);
    }

    // Villagers run in both modes: the island keeps its day while the player
    // is indoors, and whoever is in the room with them has to be animated.
    if (advance) this.villagers.update(dt, this.time.hour, this.player.position);
    else this.villagers.refreshPresence();

    this.weatherFX.update(dt, weather, camera.position, lightingOutput.darkness, indoors, time.season);
    this.underwaterFX.setStrength(indoors ? 0 : this.underwater);
    this.underwaterFX.update(dt, this.elapsed, camera.position);
    this.particles.update(dt);

    if (time.season !== this.lastSeason) {
      this.lastSeason = time.season;
      this.terrain.applySeason(time.season);
      this.foliage.applySeason(time.season);
      this.scatter.applySeason(time.season);
    }
  }

  private rippleTimer = 0;
  private smokeTimer = 0;
  private fountainTimer = 0;

  /**
   * Small, continuous world effects that make the island feel occupied:
   * ripples around a wading player, chimney smoke on cold evenings, the
   * fountain's spray, and sparks off the beach fire. All local, all cheap.
   */
  private updateAmbientEffects(dt: number, darkness: number, rain: number): void {
    // Wading and swimming disturb the water.
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (this.player.swimDepth > 0.06) {
      this.rippleTimer -= dt;
      const interval = this.player.inWater ? 0.32 : 0.2;
      if (this.rippleTimer <= 0 && (speed > 0.6 || this.player.inWater)) {
        this.rippleTimer = interval;
        const at = new Vector3(this.player.position.x, SEA_LEVEL + 0.02, this.player.position.z);
        this.particles.burst('waterRing', at, this.player.inWater ? 0.45 : 0.3);
        if (speed > 3 && !this.player.inWater) this.particles.burst('splash', at, 0.25);
      }
    }

    // Chimneys smoke when it is dim or cold; nobody lights a fire at noon.
    const season = this.time.season;
    const smoky = Math.max(darkness, season === 'Winter' ? 0.8 : season === 'Autumn' ? 0.45 : 0) * (1 - rain * 0.5);
    if (smoky > 0.25) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.26;
        for (const building of this.buildings.instances.values()) {
          if (!building.chimney) continue;
          if (building.chimney.distanceToSquared(this.player.position) > 70 * 70) continue;
          // Public buildings are shut after hours and stay cold.
          const id = building.config.id;
          if ((id === 'store' || id === 'townHall') && (this.time.hour >= 22 || this.time.hour < 7)) continue;
          this.particles.emit({
            position: building.chimney,
            velocity: new Vector3(0.15, 1.1, 0.1),
            spread: 0.25,
            color: '#d8d4cc',
            size: 0.28,
            endScale: 2.6,
            life: 3.2,
            gravity: 0.35,
            drag: 0.9,
          });
        }
      }
    }

    // Fountain spray.
    this.fountainTimer -= dt;
    if (this.fountainTimer <= 0) {
      this.fountainTimer = 0.09;
      const centre = LANDMARKS['square.center'];
      if (Math.hypot(centre.x - this.player.position.x, centre.z - this.player.position.z) < 40) {
        const top = new Vector3(centre.x, terrainHeight(centre.x, centre.z) + 2.7, centre.z);
        for (let i = 0; i < 2; i++) {
          this.particles.emit({
            position: top,
            velocity: new Vector3(0, 2.4, 0),
            spread: 0.9,
            color: i ? '#eaf7fb' : '#bfe4f0',
            size: 0.07,
            life: 0.9,
            gravity: -7,
            drag: 0.4,
          });
        }
      }
    }

    // Embers rising off the beach fire.
    const fire = this.props.campfireState;
    if (fire && fire.strength > 0.2 && Math.random() < dt * 9 * fire.strength) {
      this.particles.emit({
        position: fire.position,
        velocity: new Vector3(0, 1.6, 0),
        spread: 0.45,
        color: Math.random() < 0.5 ? '#ffb347' : '#ff7a3c',
        size: 0.06,
        endScale: 0.2,
        life: 1.4,
        gravity: 0.8,
        drag: 1.4,
        additive: true,
      });
    }
  }

  /**
   * Hides whichever walls the camera is looking through, so an interior always
   * reads as an open-fronted model rather than the back of a box.
   */
  private updateInteriorWalls(cameraPosition: Vector3): void {
    const interior = this.activeInterior;
    if (!interior) return;
    const cx = cameraPosition.x - INTERIOR_ORIGIN.x;
    const cz = cameraPosition.z - INTERIOR_ORIGIN.z;
    const length = Math.max(0.001, Math.hypot(cx, cz));

    for (const wall of interior.room.walls) {
      // A wall whose outward normal points toward the camera is between the
      // camera and the room.
      const facing = (wall.nx * cx + wall.nz * cz) / length;
      const visible = facing < 0.35;
      for (const part of wall.parts) part.visible = visible;
    }
  }

  // --- Input ---------------------------------------------------------------

  private handleGlobalInput(): void {
    if (this.input.justPressed('inventory')) {
      if (this.uiRoot.topPanelId === 'inventory') this.uiRoot.close('inventory');
      else openInventory(this.panelContext());
    }
    if (this.input.justPressed('map')) {
      if (this.uiRoot.topPanelId === 'map') this.uiRoot.close('map');
      else openMap(this.panelContext());
    }
    if (this.input.justPressed('journal')) {
      if (this.uiRoot.topPanelId === 'journal') this.uiRoot.close('journal');
      else openJournal(this.panelContext());
    }
    if (this.input.justPressed('menu')) {
      if (this.uiRoot.topPanelId === 'settings') this.uiRoot.close('settings');
      else this.openSettingsPanel();
    }
    if (this.input.justPressed('build') && !this.uiRoot.isPanelOpen && !this.dialogue.isOpen) {
      if (this.mode === 'building') this.exitBuildMode();
      else if (this.mode === 'exterior') this.enterBuildMode();
      else if (this.mode === 'interior') this.enterDecorating();
    }
    if (this.input.justPressed('cancel') && !this.uiRoot.isPanelOpen) {
      if (this.dialogue.isOpen) this.dialogue.close();
      else if (this.fishing.isActive) this.fishing.reelIn(this.player);
      else if (this.mode === 'decorating') {
        // Escape puts down what you are carrying; press it again to finish.
        if (this.furnishing.editing) this.furnishing.cancelEdit();
        else this.exitDecorating();
      } else if (this.mode === 'building') {
        if (this.landscaping.editing) {
          // Nothing to hand back: a piece in hand was never paid for.
          this.landscaping.cancelEdit();
          this.refreshBuildBar();
        } else {
          this.exitBuildMode();
        }
      } else if (this.player.diving) {
        // Coming up is always one press away, whatever else is going on.
        this.player.endDive();
      }
    }
  }

  private handleGameplayInput(dt: number): void {
    void dt;

    if (this.mode === 'decorating') {
      this.updateDecorating();
      return;
    }

    if (this.mode === 'building') {
      this.updateBuildMode();
      return;
    }

    if (this.input.justPressed('toolPrev')) this.player.cycleTool(-1);
    if (this.input.justPressed('toolNext')) this.player.cycleTool(1);

    // Social emotes. Villagers in earshot answer a wave, which is the smallest
    // possible version of "the island noticed you".
    if (!this.fishing.isActive) {
      if (this.input.justPressed('emoteWave') && this.player.emote('wave')) {
        this.bus.emit('audio:sfx', { id: 'ui.hover', volume: 0.4 });
        if (this.mode === 'exterior') this.villagers.greetFrom(this.player.position);
      } else if (this.input.justPressed('emoteCheer')) {
        this.player.emote('cheer');
      } else if (this.input.justPressed('emoteNod')) {
        this.player.emote('nod');
      } else if (this.input.justPressed('emoteSit')) {
        this.player.emote('sit');
      }
    }

    // Fishing owns the action button while a line is out.
    if (this.fishing.isActive) {
      if (this.input.justPressed('interact')) this.fishing.strike(this.player);
      const holding = this.input.isDown('interact');
      const result = this.fishing.update(
        dt,
        this.player,
        holding,
        { hour: this.time.hour, season: this.time.season, rodLevel: this.player.toolLevels.rod },
      );
      if (this.fishing.state === 'reeling') {
        this.hud.showFishingMeter();
        this.hud.updateFishingMeter(this.fishing.tension, this.fishing.progress);
      } else if (this.fishing.state === 'biting') {
        this.hud.showFishingMeter();
        this.hud.setFishingCaption(`Now! Press ${this.input.glyph('interact')}`);
        this.hud.updateFishingMeter(0.5, 0);
      } else {
        this.hud.hideFishingMeter();
      }
      if (result) this.onCatch(result.species.id, result.sizeCm, 'Reeled in');
      return;
    }
    this.hud.hideFishingMeter();

    if (this.dialogue.isOpen) {
      if (this.input.justPressed('interact')) this.dialogue.advance();
      return;
    }

    if (this.input.justPressed('interact')) {
      if (!this.interactions.trigger('interact')) {
        // Nothing bound to A here; if the player is at water with a rod, cast.
        this.tryUseTool();
      }
    }
    if (this.input.justPressed('useTool')) {
      if (!this.interactions.trigger('useTool')) this.tryUseTool();
    }
  }

  // --- Actions -------------------------------------------------------------

  private tryUseTool(): void {
    // Hands are busy swimming, and a rod cast from three metres down is not a
    // cast. Collecting is the underwater verb, and it has its own prompt.
    if (this.player.diving) return;
    if (this.player.state !== 'free' || this.player.animator.isBusy) return;
    const tool = this.player.tool;

    switch (tool) {
      case 'rod': {
        if (!this.fishing.cast(this.player, this.player.toolLevels.rod)) {
          this.uiRoot.toast('Face some open water to cast.', 'warn');
        }
        break;
      }
      case 'net': {
        this.player.performAction('netSwing', 0.62);
        window.setTimeout(() => this.resolveNetSwing(), 320);
        this.bus.emit('audio:sfx', { id: 'tool.net' });
        break;
      }
      case 'shovel': {
        this.player.performAction('shovel', 0.9);
        window.setTimeout(() => this.resolveDig(), 480);
        break;
      }
      case 'axe': {
        this.player.performAction('axe', 0.78);
        window.setTimeout(() => this.resolveChop(), 380);
        break;
      }
      case 'wateringCan': {
        this.player.performAction('water', 1.2);
        const target = this.player.forwardPoint(1.4);
        const radius = 0.9 + this.player.toolLevels.wateringCan * 0.55;
        window.setTimeout(() => {
          const count = this.farm.waterArea(target.x, target.z, radius, this.time.day);
          for (let i = 0; i < 8; i++) {
            this.particles.emit({
              position: new Vector3(target.x, target.y + 0.9, target.z),
              velocity: new Vector3(0, -1, 0),
              spread: 0.5,
              color: '#a8ddf0',
              size: 0.06,
              life: 0.6,
              gravity: -9,
            });
          }
          if (count > 0) this.uiRoot.toast(`Watered ${count} ${count === 1 ? 'plot' : 'plots'}.`, 'good');
        }, 420);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Which bugs are out, here, now.
   *
   * Shared by the net and by what falls out of a shaken tree, because those are
   * two ways of catching the same insect and any rule one enforces and the
   * other does not is a way around it. The tree drop used to check only the
   * region, which made a daytime shake on the point a way to collect the
   * Beacon Moth before the lighthouse it follows had been lit.
   */
  private bugsActiveIn(region: RegionId, hour: number): SpeciesDef[] {
    return BUGS.filter((bug) => {
      if (!speciesBelongsIn(bug, region)) return false;
      if (bug.id === 'bug.beaconMoth' && !this.townWorks.lighthouse) return false;
      if (!bug.activeHours) return true;
      const [from, to] = bug.activeHours;
      return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
    });
  }

  /**
   * Swings the net at whatever is actually in front of the player.
   *
   * This used to filter the catalogue and roll against a flat miss chance, with
   * nothing in the world to aim at. Now the swing reaches for the nearest
   * insect in an arc ahead: whether there is anything to catch is a question
   * about the world, and whether you get it is a question about how you
   * approached it.
   */
  private resolveNetSwing(): void {
    const origin = this.player.position;
    const target = this.player.forwardPoint(1.6);
    if (this.isSealed(target.x, target.z)) {
      this.particles.burst('leaves', target, 0.4);
      this.uiRoot.toast('The hedge is in the way.', 'neutral');
      return;
    }

    const insect = this.insects.nearestInArc(origin.x, origin.z, this.player.facing, NET_REACH, NET_HALF_ANGLE);
    if (!insect) {
      this.particles.burst('leaves', target, 0.4);
      const region = regionAt(target.x, target.z);
      const flying = this.bugsActiveIn(region, this.time.hour);
      this.uiRoot.toast(
        flying.length === 0
          ? `Nothing is flying in ${regionLabel(region)} right now.`
          : 'Nothing in the net. Get closer to one first.',
        'neutral',
      );
      return;
    }

    const species = SPECIES_BY_ID.get(insect.speciesId);
    if (!species) {
      this.insects.take(insect);
      return;
    }

    // Settled is the easy catch and fleeing is nearly hopeless, which is what
    // makes walking rather than running the skill.
    const base = insect.state === 'settled' ? 0.95 : insect.state === 'fleeing' ? 0.3 : 0.74;
    const shy = species.rarity === 'legendary' ? 0.3 : species.rarity === 'rare' ? 0.18 : 0;
    const net = (this.player.toolLevels.net - 1) * 0.08;
    const at = new Vector3(insect.x, insect.y, insect.z);
    if (Math.random() > clamp01(base - shy + net)) {
      this.insects.startle(insect, origin.x, origin.z);
      this.particles.burst('leaves', at, 0.35);
      this.bus.emit('audio:sfx', { id: 'ui.error', volume: 0.5 });
      this.uiRoot.toast('It slipped the net.', 'neutral');
      return;
    }

    // Into the bag first, and only then out of the world — the same order the
    // reef uses, and for the same reason. A full bag makes `onCatch` refuse,
    // and taking the insect first would delete it and award nothing.
    if (!this.onCatch(species.id, undefined, 'Netted')) {
      this.uiRoot.toast('No room in your bag for that.', 'warn');
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return;
    }
    this.insects.take(insect);
    this.particles.burst('sparkle', at, 0.8);
  }

  /**
   * Takes a sea creature off the shelf.
   *
   * It goes into a pocket rather than the bag: the reveal waits for the
   * surface, which is what makes the choice between grabbing one more and
   * going up while the air lasts an actual choice.
   */
  private collectReef(found: ReefCollectible): void {
    // Into the bag first, and only then off the shelf. The other order loses
    // the creature outright to an autosave taken mid-dive — the reef would
    // remember it gone and the bag would never have had it.
    if (!this.onCatch(found.speciesId, undefined, 'Brought up', true)) {
      this.uiRoot.toast('No room in your bag for that.', 'warn');
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return;
    }
    this.reef.collect(found, this.time.day);
    this.particles.burst('sparkle', new Vector3(found.x, found.y + found.hover, found.z), 0.7);
    this.bus.emit('audio:sfx', { id: 'item.pickup' });
    this.player.emoteBubble('sparkle', 1.0);
    this.uiRoot.toast(
      this.pendingDiveCards.length === 1
        ? 'Tucked away. Surface to see what it is.'
        : `${this.pendingDiveCards.length} to bring up.`,
      'good',
    );
    this.save.markDirty();
  }

  private resolveDig(): void {
    const at = this.player.forwardPoint(1.2);
    const node = this.props.nodeNear(at.x, at.z, 2.2, this.time.day, ['digSpot']);
    this.particles.burst('dirt', new Vector3(at.x, terrainHeight(at.x, at.z) + 0.1, at.z), 1);
    this.cameraRig.shake(0.16);
    this.bus.emit('audio:sfx', { id: 'tool.dig' });

    if (!node) {
      this.uiRoot.toast('Just soil here. Look for a star-shaped crack.', 'neutral');
      return;
    }
    node.harvestedOnDay = this.time.day;
    this.props.refreshNodes(this.time.day);

    const fossil = weightedPick(FOSSILS, FOSSILS.map((f) => (f.rarity === 'common' ? 100 : f.rarity === 'uncommon' ? 38 : 11)));
    this.onCatch(fossil.id, undefined, 'Unearthed');
  }

  private resolveChop(): void {
    const at = this.player.forwardPoint(1.4);
    const tree = this.foliage.treeNear(at.x, at.z, 2.6);
    const rock = this.props.nodeNear(at.x, at.z, 2.6, this.time.day, ['rock']);

    if (tree && (!rock || Math.hypot(tree.x - at.x, tree.z - at.z) < Math.hypot(rock.x - at.x, rock.z - at.z))) {
      this.foliage.shakeTree(tree);
      this.particles.burst('woodChips', new Vector3(tree.x, tree.y + 1.4, tree.z), 1);
      this.cameraRig.shake(0.2);
      this.bus.emit('audio:sfx', { id: 'tool.axe' });
      const amount = this.player.toolLevels.axe;
      for (let i = 0; i < amount; i++) {
        this.drops.spawn('mat.wood', new Vector3(tree.x, tree.y + 1.6, tree.z), () => {
          this.materials.wood += 1;
          this.quests.record('gather', 1);
          this.save.markDirty();
          return true;
        });
      }
      return;
    }

    if (rock) {
      this.particles.burst('stoneChips', new Vector3(rock.x, rock.y + 0.6, rock.z), 1);
      this.cameraRig.shake(0.22);
      this.bus.emit('audio:sfx', { id: 'tool.mine' });
      rock.harvestedOnDay = this.time.day;
      this.props.refreshNodes(this.time.day);
      const amount = 1 + this.player.toolLevels.shovel;
      for (let i = 0; i < amount; i++) {
        this.drops.spawn('mat.stone', new Vector3(rock.x, rock.y + 0.9, rock.z), () => {
          this.materials.stone += 1;
          this.quests.record('gather', 1);
          this.save.markDirty();
          return true;
        });
      }
      return;
    }

    this.uiRoot.toast('Nothing to swing at here.', 'neutral');
  }

  /**
   * Shared handler for anything that produces a species.
   *
   * Returns false when the bag had no room, so a caller that took the creature
   * out of the world can put it back.
   *
   * @param deferReveal Holds the catch card instead of showing it, for the
   * diver: the item itself lands in the bag now — a deferred *item* would be
   * lost to an autosave, or to a bag that filled up between the seabed and the
   * surface — and only the reveal waits for the player to come up.
   */
  private onCatch(defId: string, sizeCm: number | undefined, headline: string, deferReveal = false): boolean {
    const species = SPECIES_BY_ID.get(defId);
    if (!species) return false;
    const measured = sizeCm ?? rollSize(species);
    const item = this.inventory.addById(defId, { sizeCm: measured, day: this.time.day });
    if (!item) return false;

    this.stats.totalCaught += 1;
    this.quests.record('catch', 1);

    const previousRecord = this.stats.records[defId] ?? 0;
    const isRecord = measured !== undefined && measured > previousRecord && previousRecord > 0;
    if (measured !== undefined && measured > previousRecord) this.stats.records[defId] = measured;

    const isNew = !this.museum.has(defId);
    this.bus.emit('audio:sfx', {
      id: species.rarity === 'rare' || species.rarity === 'legendary' ? 'catch.rare' : 'catch.common',
    });
    if (species.rarity === 'rare' || species.rarity === 'legendary') this.cameraRig.shake(0.25);

    // A reeled-in fish leaps out of the water and flies to the player before
    // the card appears, so the catch happens in the world first.
    const reeled = headline === 'Reeled in';
    if (reeled) {
      const from = this.fishing.bobberWorldPosition.clone();
      // Offset the bobber's own height rather than replacing it: a fish reeled
      // out of the creek is landed metres above sea level, and pinning the leap
      // to SEA_LEVEL would start it underground.
      from.y += 0.1;
      this.drops.spawn(defId, from, () => true, { upward: 6.2, spread: 0.15 });
      this.particles.burst('sparkle', from, 0.6);
    }
    const show = () => this.bus.emit('ui:catchCard', {
      item,
      headline,
      sizeCm: measured,
      isNewSpecies: isNew,
      isRecord,
    });
    if (deferReveal) this.pendingDiveCards.push(show);
    else if (reeled) window.setTimeout(show, 620);
    else show();
    this.save.markDirty();
    return true;
  }

  private addCoins(amount: number): void {
    this.coins = Math.max(0, this.coins + amount);
    this.bus.emit('currency:changed', { coins: this.coins, delta: amount });
    if (amount > 0) this.bus.emit('audio:sfx', { id: 'money.coin' });
    this.save.markDirty();
  }

  // --- Day cycle -----------------------------------------------------------

  private onNewDay(day: number): void {
    this.props.refreshNodes(day);
    this.foliage.refreshFruit(day);
    this.reef.refresh(day);
    this.farm.newDay(day);
    this.quests.rollDaily(day, this.lastTownRating);

    // A villager may ask for something each morning.
    const candidate = VILLAGERS[Math.floor(Math.random() * VILLAGERS.length)];
    if (Math.random() < 0.6) {
      const request = this.relationships.issueRequest(candidate.id, day);
      if (request) this.villagers.markerFor(candidate.id, true);
    }

    this.uiRoot.toast(`Day ${day} · ${this.time.season}`, 'good');
    this.uiRoot.showLocation(`Day ${day}`, this.time.season);
    this.save.markDirty();
    this.save.write(this.snapshot());
  }

  // --- Interiors -----------------------------------------------------------

  private async enterBuilding(id: BuildingId): Promise<void> {
    const building = this.buildings.instances.get(id);
    if (!building || !building.config.interior) return;

    this.bus.emit('audio:sfx', { id: 'door.open' });
    await this.uiRoot.transition(async () => {
      this.disposeInterior();
      const interior = this.createInterior(building.config.interior!, id);
      this.activeInterior = interior;
      this.activeBuildingId = id;
      this.interiorRoot.add(interior.group);
      this.interiorRoot.visible = true;
      this.exteriorRoot.visible = false;
      this.weatherFX.group.visible = false;
      this.villagers.setActiveInterior({ building: id, anchors: worldAnchors(interior) });

      this.mode = 'interior';
      this.player.teleport(
        INTERIOR_ORIGIN.x + interior.room.entry.x,
        INTERIOR_ORIGIN.z + interior.room.entry.z,
        Math.PI,
        0,
      );
      // Interiors are viewed as open-topped models: the camera rides above the
      // walls and looks down through the missing ceiling, so nothing occludes
      // the room and the framing works for a cottage and a museum alike.
      const b = interior.room.bounds;
      const margin = 16;
      this.cameraRig.bounds = null;
      this.cameraRig.positionBounds = {
        minX: b.minX + INTERIOR_ORIGIN.x - margin,
        maxX: b.maxX + INTERIOR_ORIGIN.x + margin,
        minZ: b.minZ + INTERIOR_ORIGIN.z - margin,
        maxZ: b.maxZ + INTERIOR_ORIGIN.z + margin,
      };
      this.cameraRig.terrainClamp = false;
      this.cameraRig.setPreset('interior', true);
      this.cameraRig.clearOcclusion();
      this.cameraRig.occluders = [];
      // Place the camera behind the player, who is facing into the room.
      this.cameraRig.snapTo(this.player.position, 0);
      this.registerInteriorInteractions(interior);
    }, 340, 420);

    this.uiRoot.showLocation(this.activeInterior?.title ?? '', 'Interior');
    this.updateMusic();
  }

  private createInterior(kind: string, buildingId: BuildingId): InteriorScene {
    switch (kind) {
      case 'home': {
        const interior = createHomeInterior(this.homeLevel);
        interior.group.add(this.furnishing.group);
        return interior;
      }
      case 'museum':
        return createMuseumInterior(this.museum);
      case 'shop':
        return createShopInterior();
      case 'townhall':
        return createTownHallInterior();
      case 'npcHome':
      default: {
        const villagerId = buildingId.replace('home.', '');
        const villager = VILLAGERS_BY_ID.get(villagerId);
        return createVillagerHomeInterior(villagerId, villager?.look.outfit ?? '#7fa86a');
      }
    }
  }

  private disposeInterior(): void {
    if (!this.activeInterior) return;
    // The anchors go with the room, so nobody may keep pointing at them.
    this.villagers.setActiveInterior(null);
    // Keep the furnishing group alive; it belongs to the game, not the room.
    if (this.furnishing.group.parent === this.activeInterior.group) {
      this.interiorRoot.add(this.furnishing.group);
    }
    this.interiorRoot.remove(this.activeInterior.group);
    // The room kit bakes a floor texture and builds fresh geometry and
    // materials for every entry, so dropping the group alone would leak a
    // room's worth of GPU resources each time a door is used.
    disposeObject(this.activeInterior.group);
    this.activeInterior = null;
  }

  private async exitInterior(): Promise<void> {
    const buildingId = this.activeBuildingId;
    this.bus.emit('audio:sfx', { id: 'door.close' });

    await this.uiRoot.transition(async () => {
      this.disposeInterior();
      this.activeBuildingId = null;
      this.interiorRoot.visible = false;
      this.exteriorRoot.visible = true;
      this.weatherFX.group.visible = true;
      this.mode = 'exterior';

      const building = buildingId ? this.buildings.instances.get(buildingId) : null;
      const spot = building?.doorway ?? new Vector3(0, 0, 6);
      this.player.teleport(spot.x, spot.z, building?.doorFacing ?? Math.PI);
      this.cameraRig.bounds = new Box3(
        new Vector3(-ISLAND_HALF + 6, -20, -ISLAND_HALF + 6),
        new Vector3(ISLAND_HALF - 6, 60, ISLAND_HALF - 6),
      );
      this.cameraRig.positionBounds = null;
      this.cameraRig.terrainClamp = true;
      this.cameraRig.setPreset('exterior', true);
      this.cameraRig.occluders = [...this.buildings.occluders, ...this.foliage.occluders];
      this.cameraRig.snapTo(this.player.position, (building?.doorFacing ?? Math.PI) + Math.PI);
      this.registerExteriorInteractions();
    }, 340, 420);

    this.updateMusic();
  }

  // --- Decorating ----------------------------------------------------------

  private enterDecorating(): void {
    if (this.activeInterior?.id !== 'home') {
      this.uiRoot.toast('Decorating happens inside your cottage.', 'warn');
      return;
    }
    this.mode = 'decorating';
    this.cameraRig.setPreset('exteriorClose');
    this.uiRoot.toast(`Decorating · ${this.input.glyph('interact')} pick up or place · ${this.input.glyph('useTool')} rotate · ${this.input.glyph('cancel')} finish`, 'good');
  }

  private exitDecorating(): void {
    this.furnishing.confirmEdit();
    this.mode = 'interior';
    this.cameraRig.setPreset('interior');
    this.uiRoot.toast('Looks good.', 'good');
    this.save.markDirty();
  }

  private updateDecorating(): void {
    const local = new Vector3(
      this.player.position.x - INTERIOR_ORIGIN.x,
      0,
      this.player.position.z - INTERIOR_ORIGIN.z,
    );

    if (this.furnishing.editing) {
      // The held piece floats in front of the player.
      const target = local.clone().add(new Vector3(Math.sin(this.player.facing) * 1.5, 0, Math.cos(this.player.facing) * 1.5));
      this.furnishing.updateEdit(target.x, target.z);
      if (this.input.justPressed('useTool')) this.furnishing.rotateEdit();
      if (this.input.justPressed('interact')) {
        if (this.furnishing.confirmEdit()) this.save.markDirty();
      }
      return;
    }

    if (this.input.justPressed('interact')) {
      const piece = this.furnishing.nearest(local.x, local.z, 1.8);
      if (piece) this.furnishing.beginEdit(piece);
      else this.uiRoot.toast('Stand next to a piece of furniture to move it.', 'neutral');
    }
    if (this.input.justPressed('useTool')) {
      const piece = this.furnishing.nearest(local.x, local.z, 1.8);
      if (piece) {
        const defId = this.furnishing.remove(piece.uid);
        if (defId) {
          this.uiRoot.toast('Stored.', 'neutral');
          this.save.markDirty();
        }
      }
    }
  }

  // --- Outdoor build mode --------------------------------------------------

  /** Which piece of the outdoor catalogue the cursor is holding. */
  private buildIndex = 0;
  /** The colourway last used for each piece, so a run of beds matches. */
  private buildTints = new Map<string, string>();

  /** The catalogue entry the build cursor is currently offering. */
  private get buildPiece() {
    return DECOR[this.buildIndex];
  }

  /**
   * Opens landscaping. Refused from anywhere the cursor could not reach the
   * ground it is meant to be placing on — indoors, or out of your depth.
   */
  private enterBuildMode(): void {
    if (this.mode !== 'exterior') {
      this.uiRoot.toast('Step outside to landscape.', 'warn');
      return;
    }
    if (this.player.diving || this.player.inWater) {
      this.uiRoot.toast('Not from the water.', 'warn');
      return;
    }
    if (this.fishing.isActive) return;
    this.mode = 'building';
    this.cameraRig.setPreset('exteriorClose');
    this.hud.showBuildBar();
    this.refreshBuildBar();
    this.uiRoot.toast(
      `Landscaping · ${this.input.glyph('toolPrev')}${this.input.glyph('toolNext')} choose · `
      + `${this.input.glyph('interact')} place · ${this.input.glyph('useTool')} take back up · `
      + `${this.input.glyph('cancel')} finish`,
      'good',
    );
  }

  /** Closes landscaping, settling whatever is still in the player's hands. */
  private exitBuildMode(): void {
    // Anything still in hand goes down where it is, or back on the shelf if
    // that spot will not take it.
    const held = this.landscaping.editing;
    if (held) {
      if (this.canAffordDecor(held.def) && this.landscaping.confirmEdit()) {
        this.spendDecor(held.def, 1);
        if (held.def.greenery) this.stats.flowersPlanted += 1;
      } else {
        this.landscaping.cancelEdit();
      }
    }
    this.mode = 'exterior';
    this.cameraRig.setPreset('exterior');
    this.hud.hideBuildBar();
    this.uiRoot.toast('Looks good.', 'good');
    this.save.markDirty();
  }

  /**
   * Build mode's frame.
   *
   * Deliberately the same grammar as decorating indoors — place with the action
   * button, rotate or take away with the tool button, cycle with the shoulder
   * buttons — so there is one set of building controls in the game rather than
   * two that nearly match.
   */
  private updateBuildMode(): void {
    if (this.landscaping.editing) {
      const target = this.player.forwardPoint(2.1);
      this.landscaping.updateEdit(target.x, target.z);
      if (this.input.justPressed('useTool')) this.landscaping.rotateEdit();
      if (this.input.justPressed('toolNext') || this.input.justPressed('toolPrev')) {
        if (this.landscaping.cycleTint()) {
          const held = this.landscaping.editing;
          if (held?.tint) this.buildTints.set(held.defId, held.tint);
          this.refreshBuildBar();
        }
      }
      if (this.input.justPressed('interact')) {
        const piece = this.landscaping.editing;
        // Coins cannot change while build mode is open, but the check belongs
        // next to the charge rather than three presses earlier.
        if (piece && !this.canAffordDecor(piece.def)) {
          this.uiRoot.toast(`Not enough for a ${piece.def.name.toLowerCase()}.`, 'warn');
          this.bus.emit('audio:sfx', { id: 'ui.error' });
        } else if (this.landscaping.confirmEdit()) {
          if (piece) this.spendDecor(piece.def, 1);
          // A lifetime tally for the journal. The island's rating counts what
          // is planted right now, which is a different question.
          if (piece?.def.greenery) this.stats.flowersPlanted += 1;
          this.save.markDirty();
          this.refreshBuildBar();
        }
      }
      return;
    }

    if (this.input.justPressed('toolNext')) this.cycleBuildPiece(1);
    if (this.input.justPressed('toolPrev')) this.cycleBuildPiece(-1);

    // Place is always place. It used to pick up a nearby piece instead when
    // there was one in reach, which made laying a run of fence panels
    // impossible: every panel put the next press within reach of the last one.
    if (this.input.justPressed('interact')) {
      this.beginPlacingDecor();
      this.refreshBuildBar();
    }

    if (this.input.justPressed('useTool')) this.takeUpNearestDecor();
  }

  /**
   * Takes the nearest piece back up, refunded in full.
   *
   * Also makes it the selected piece, colourway and all, because taking one up
   * is how you move it: put it back down wherever you actually wanted it and
   * nothing has been lost but the walk.
   */
  private takeUpNearestDecor(): void {
    // Wide enough to reach past a solid piece's own collider, which holds the
    // player about a metre and a half off a bench or a fence panel.
    const near = this.landscaping.nearest(this.player.position.x, this.player.position.z, 2.4);
    if (!near) {
      this.uiRoot.toast('Stand next to something you put down to take it up.', 'neutral');
      return;
    }
    const tint = near.tint;
    const defId = this.landscaping.remove(near.uid);
    if (!defId) return;
    this.refundDecor(defId);
    const index = DECOR.findIndex((d) => d.id === defId);
    if (index >= 0) {
      this.buildIndex = index;
      if (tint) this.buildTints.set(defId, tint);
    }
    this.uiRoot.toast('Taken up.', 'neutral');
    this.refreshBuildBar();
    this.save.markDirty();
  }

  /** Steps through the outdoor catalogue, wrapping at either end. */
  private cycleBuildPiece(direction: 1 | -1): void {
    this.buildIndex = (this.buildIndex + direction + DECOR.length) % DECOR.length;
    this.bus.emit('audio:sfx', { id: 'ui.hover', volume: 0.5 });
    this.refreshBuildBar();
  }

  /**
   * Takes a piece of the selected kind into the player's hands.
   *
   * Nothing is charged for it yet: a piece in hand is not a piece placed, and
   * charging here meant an autosave taken mid-carry had already billed for
   * something that was never put down.
   */
  private beginPlacingDecor(): void {
    const def = this.buildPiece;
    if (!this.canAffordDecor(def)) {
      this.uiRoot.toast(`Not enough for a ${def.name.toLowerCase()}.`, 'warn');
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return;
    }
    const target = this.player.forwardPoint(2.1);
    this.landscaping.beginPlacing(def.id, target.x, target.z, this.buildTints.get(def.id) ?? def.tints?.[0]);
    this.refreshBuildBar();
  }

  private canAffordDecor(def: (typeof DECOR)[number]): boolean {
    if (this.coins < def.price) return false;
    const cost = def.cost ?? {};
    return this.materials.wood >= (cost.wood ?? 0)
      && this.materials.stone >= (cost.stone ?? 0)
      && this.materials.fiber >= (cost.fiber ?? 0);
  }

  /** @param sign 1 to charge for a piece, -1 to hand it back. */
  private spendDecor(def: (typeof DECOR)[number], sign: 1 | -1): void {
    this.addCoins(-def.price * sign);
    const cost = def.cost ?? {};
    this.materials.wood -= (cost.wood ?? 0) * sign;
    this.materials.stone -= (cost.stone ?? 0) * sign;
    this.materials.fiber -= (cost.fiber ?? 0) * sign;
  }

  /**
   * Hands back everything a piece cost.
   *
   * In full, not at a markdown: taking a bench back up is moving it, not
   * selling it, and a game that charges for changing your mind gets decorated
   * once and then left alone.
   */
  private refundDecor(defId: string): void {
    const def = DECOR_BY_ID.get(defId);
    if (def) this.spendDecor(def, -1);
  }

  /**
   * Keeps the bar showing what is actually in the player's hands.
   *
   * While a piece is held the shoulder buttons cycle its colourway rather than
   * the catalogue, so a bar that went on naming the catalogue selection would
   * be describing something the player is not holding and cannot place.
   */
  private refreshBuildBar(): void {
    const held = this.landscaping.editing;
    const def = held?.def ?? this.buildPiece;
    this.hud.updateBuildBar({
      name: def.name,
      description: def.description,
      price: def.price,
      cost: def.cost,
      // What is in hand has already been paid for.
      affordable: held ? true : this.canAffordDecor(def),
      holding: !!held,
      hasTints: (def.tints?.length ?? 0) > 1,
    });
  }

  // --- Interactions --------------------------------------------------------

  /**
   * Talking to whoever is standing nearby. Registered in interiors as well as
   * outdoors: the shopkeeper behind the counter and the curator at her desk
   * are ordinary neighbours who happen to be indoors, and the manager only
   * offers up the ones in the same room as the player.
   */
  private registerVillagerInteraction(): void {
    this.interactions.register('villagers', () => {
      const villager = this.villagers.nearest(this.player.position, 3.2);
      if (!villager) return null;
      const request = this.relationships.get(villager.def.id).request;
      const hasOpenRequest = !!request && !request.done && this.inventory.has(request.itemDefId);
      return {
        id: `talk.${villager.def.id}`,
        kind: 'talk',
        label: hasOpenRequest ? 'Hand over' : 'Talk',
        detail: villager.def.name,
        action: 'interact',
        priority: 90,
        worldX: villager.position.x,
        worldY: villager.position.y + 2.0,
        worldZ: villager.position.z,
        perform: () => this.talkTo(villager.def.id),
      } satisfies InteractionOption;
    });
  }

  private registerExteriorInteractions(): void {
    this.interactions.clear();

    this.registerVillagerInteraction();

    this.interactions.register('doors', () => {
      const options: InteractionOption[] = [];
      for (const [id, building] of this.buildings.instances) {
        if (!building.config.enterable) continue;
        const distance = building.doorway.distanceTo(this.player.position);
        if (distance > 3.0) continue;
        options.push({
          id: `enter.${id}`,
          kind: 'enter',
          label: 'Enter',
          detail: building.config.name,
          action: 'interact',
          priority: 80,
          worldX: building.doorway.x,
          worldY: building.doorway.y + 2.4,
          worldZ: building.doorway.z,
          perform: () => void this.enterBuilding(id),
        });
      }
      return options;
    });

    this.interactions.register('trees', () => {
      const tree = this.foliage.treeNear(this.player.position.x, this.player.position.z, 2.6);
      if (!tree || this.isSealed(tree.x, tree.z)) return null;
      const fruitReady = tree.hasFruit && this.time.day - tree.harvestedOnDay >= 3;
      return {
        id: `tree.${tree.id}`,
        kind: 'shake',
        label: fruitReady ? 'Pick fruit' : 'Shake',
        action: 'interact',
        priority: 40,
        worldX: tree.x,
        worldY: tree.y + 3.6,
        worldZ: tree.z,
        perform: () => this.shakeTree(tree.id),
      } satisfies InteractionOption;
    });

    this.interactions.register('nodes', () => {
      const node = this.props.nodeNear(this.player.position.x, this.player.position.z, 2.2, this.time.day);
      if (!node || this.isSealed(node.x, node.z)) return null;
      const labels = {
        rock: 'Mine',
        digSpot: 'Dig',
        shell: 'Pick up',
        stick: 'Pick up',
        forage: 'Gather',
      } as const;
      return {
        id: `node.${node.id}`,
        kind: node.kind === 'rock' ? 'mine' : node.kind === 'digSpot' ? 'dig' : 'gather',
        label: node.kind === 'forage' && node.defId
          ? `Pick ${getItemDef(node.defId)?.name ?? 'it'}`
          : labels[node.kind],
        action: 'interact',
        priority: 50,
        worldX: node.x,
        worldY: node.y + 1.2,
        worldZ: node.z,
        perform: () => this.useNode(node.id),
      } satisfies InteractionOption;
    });

    this.interactions.register('orchardGate', () => {
      const gate = this.props.orchardGate;
      if (gate.isOpen) return null;
      const distance = Math.hypot(this.player.position.x - gate.x, this.player.position.z - gate.z);
      if (distance > 3.4) return null;
      // The brass key is the first thing the story hands over; until Juniper
      // works out what it opens, the padlock is all there is to read.
      const hasKey = this.quests.storyStage >= 1;
      return {
        id: 'orchard.gate',
        kind: 'custom',
        label: hasKey ? 'Unlock the gate' : 'Padlocked',
        detail: 'Secret Orchard',
        action: 'interact',
        priority: 70,
        worldX: gate.x,
        worldY: gate.y + 2.6,
        worldZ: gate.z,
        ...(hasKey ? {} : { disabledReason: 'The keyhole is shaped like a leaf' }),
        perform: () => this.openOrchardGate(),
      } satisfies InteractionOption;
    });

    this.interactions.register('spyglass', () => {
      const point = LANDMARKS['lighthouse.point'];
      const x = point.x - 3.4;
      const z = point.z + 7.2;
      if (Math.hypot(this.player.position.x - x, this.player.position.z - z) > 2.4) return null;
      return {
        id: 'point.spyglass',
        kind: 'read',
        label: 'Look through',
        detail: 'Keeper\u2019s spyglass',
        action: 'interact',
        priority: 55,
        worldX: x,
        worldY: terrainHeight(x, z) + 2.2,
        worldZ: z,
        perform: () => this.useSpyglass(),
      } satisfies InteractionOption;
    });

    this.interactions.register('farm', () => {
      const ahead = this.player.forwardPoint(1.2);
      const plot = this.farm.plotNear(ahead.x, ahead.z, 1.3);
      if (plot) {
        const ready = Farm.stageFor(plot.growth) === 'mature';
        if (!plot.cropId) {
          return {
            id: `plot.plant.${plot.id}`,
            kind: 'plant',
            label: this.seeds > 0 ? 'Plant a seed' : 'No seeds',
            action: 'interact',
            priority: 60,
            worldX: plot.x,
            worldY: plot.y + 0.9,
            worldZ: plot.z,
            ...(this.seeds > 0 ? {} : { disabledReason: 'No seeds' }),
            perform: () => this.plantSeed(plot.id),
          } satisfies InteractionOption;
        }
        if (ready) {
          return {
            id: `plot.harvest.${plot.id}`,
            kind: 'harvest',
            label: 'Harvest',
            action: 'interact',
            priority: 62,
            worldX: plot.x,
            worldY: plot.y + 0.9,
            worldZ: plot.z,
            perform: () => this.harvestPlot(plot.id),
          } satisfies InteractionOption;
        }
        return null;
      }

      if (this.player.tool === 'shovel' && this.farm.canTill(ahead.x, ahead.z)) {
        return {
          id: 'plot.till',
          kind: 'till',
          label: 'Till soil',
          action: 'interact',
          priority: 30,
          worldX: ahead.x,
          worldY: terrainHeight(ahead.x, ahead.z) + 0.7,
          worldZ: ahead.z,
          perform: () => {
            const plot = this.farm.till(ahead.x, ahead.z, this.time.day);
            if (plot) {
              this.player.performAction('shovel', 0.9);
              this.particles.burst('dirt', new Vector3(plot.x, plot.y + 0.2, plot.z), 0.7);
              this.save.markDirty();
            }
          },
        } satisfies InteractionOption;
      }
      return null;
    });

    this.interactions.register('water', () => {
      if (this.player.tool !== 'rod' || this.fishing.isActive || this.player.diving) return null;
      const ahead = this.player.forwardPoint(4);
      if (waterDepth(ahead.x, ahead.z) < 0.55) return null;
      return {
        id: 'water.cast',
        kind: 'fish',
        label: 'Cast',
        action: 'useTool',
        priority: 20,
        worldX: ahead.x,
        worldY: SEA_LEVEL + 0.6,
        worldZ: ahead.z,
        perform: () => this.tryUseTool(),
      } satisfies InteractionOption;
    });

    // Diving. Offered wherever the player is already swimming and the water
    // below is worth going into.
    this.interactions.register('dive', () => {
      if (!this.player.inWater || this.fishing.isActive) return null;
      const { x, z } = this.player.position;
      if (this.player.diving) {
        return {
          id: 'dive.surface',
          kind: 'dive',
          label: 'Surface',
          action: 'interact',
          priority: 70,
          worldX: x,
          worldY: SEA_LEVEL + 1.1,
          worldZ: z,
          perform: () => this.player.endDive(),
        } satisfies InteractionOption;
      }
      if (waterDepth(x, z) < DIVE_MIN_DEPTH) return null;
      return {
        id: 'dive.down',
        kind: 'dive',
        label: 'Dive',
        detail: 'See what is down there',
        action: 'interact',
        priority: 70,
        worldX: x,
        worldY: SEA_LEVEL + 1.1,
        worldZ: z,
        perform: () => this.player.beginDive(),
      } satisfies InteractionOption;
    });

    this.interactions.register('reef', (context) => {
      if (!this.player.diving) return null;
      const found = this.reef.nearest(
        this.player.position.x,
        this.player.position.y,
        this.player.position.z,
        2.6,
        context.hour,
        context.day,
      );
      if (!found) return null;
      return {
        id: `reef.${found.id}`,
        kind: 'gather',
        label: 'Collect',
        action: 'useTool',
        priority: 95,
        worldX: found.x,
        worldY: found.y + found.hover + 0.6,
        worldZ: found.z,
        perform: () => this.collectReef(found),
      } satisfies InteractionOption;
    });

    this.interactions.register('insects', () => {
      if (this.player.tool !== 'net' || this.player.diving || this.fishing.isActive) return null;
      const insect = this.insects.nearest(this.player.position.x, this.player.position.z, NET_REACH);
      if (!insect || this.isSealed(insect.x, insect.z)) return null;
      return {
        id: `bug.${insect.id}`,
        kind: 'catch',
        // Named by silhouette, not species: finding out which one it was is
        // the point of swinging.
        detail: INSECT_WORD[insect.shape],
        label: 'Catch',
        action: 'useTool',
        priority: 60,
        worldX: insect.x,
        worldY: insect.y + 0.55,
        worldZ: insect.z,
        perform: () => this.tryUseTool(),
      } satisfies InteractionOption;
    });

    this.interactions.register('bench', () => {
      const bench = LANDMARKS['square.bench'];
      const distance = Math.hypot(this.player.position.x - bench.x, this.player.position.z - bench.z);
      if (distance > 2.2) return null;
      return {
        id: 'bench.sit',
        kind: 'sit',
        label: this.player.state === 'sitting' ? 'Stand up' : 'Sit',
        action: 'interact',
        priority: 35,
        worldX: bench.x,
        worldY: terrainHeight(bench.x, bench.z) + 1.4,
        worldZ: bench.z,
        perform: () => {
          if (this.player.state === 'sitting') this.player.stand();
          else this.player.sit();
        },
      } satisfies InteractionOption;
    });
  }

  private registerInteriorInteractions(interior: InteriorScene): void {
    this.interactions.clear();
    const world = (v: Vector3) => new Vector3(v.x + INTERIOR_ORIGIN.x, v.y, v.z + INTERIOR_ORIGIN.z);

    this.registerVillagerInteraction();

    this.interactions.register('exit', () => {
      const exit = world(interior.anchors.exit);
      if (exit.distanceTo(this.player.position) > 2.4) return null;
      return {
        id: 'interior.exit',
        kind: 'exit',
        label: 'Go outside',
        action: 'interact',
        priority: 70,
        worldX: exit.x,
        worldY: 2.2,
        worldZ: exit.z,
        perform: () => void this.exitInterior(),
      } satisfies InteractionOption;
    });

    const anchorPrompt = (
      key: string,
      label: string,
      priority: number,
      perform: () => void,
      radius = 2.4,
    ) => {
      this.interactions.register(key, () => {
        const anchor = interior.anchors[key];
        if (!anchor) return null;
        const point = world(anchor);
        if (point.distanceTo(this.player.position) > radius) return null;
        return {
          id: `interior.${key}`,
          kind: 'custom',
          label,
          action: 'interact',
          priority,
          worldX: point.x,
          worldY: 1.8,
          worldZ: point.z,
          perform,
        } satisfies InteractionOption;
      });
    };

    if (interior.id === 'home') {
      anchorPrompt('wardrobe', 'Change clothes', 82, () => openWardrobe(this.panelContext(), (look) => {
        this.look = look;
        this.player.setLook(look);
        this.save.markDirty();
      }));
      anchorPrompt('kitchen', 'Cook', 82, () => openCooking(this.panelContext()));
      anchorPrompt('storage', 'Home & decorating', 82, () => openHome(this.panelContext()));

      this.interactions.register('decorate', () => {
        const local = new Vector3(
          this.player.position.x - INTERIOR_ORIGIN.x,
          0,
          this.player.position.z - INTERIOR_ORIGIN.z,
        );
        const piece = this.furnishing.nearest(local.x, local.z, 1.6);
        if (!piece || this.mode === 'decorating') return null;
        return {
          id: 'decorate.start',
          kind: 'decorate',
          label: 'Move furniture',
          detail: piece.def.name,
          action: 'useTool',
          priority: 40,
          worldX: piece.x + INTERIOR_ORIGIN.x,
          worldY: 1.2,
          worldZ: piece.z + INTERIOR_ORIGIN.z,
          perform: () => this.enterDecorating(),
        } satisfies InteractionOption;
      });
    }

    if (interior.id === 'museum') {
      // No standing "Talk to Juniper" at the desk: she is a villager in the
      // room now, so the prompt follows her, and is absent when she is out.
      this.interactions.register('donate', () => {
        const curator = world(interior.anchors.curator);
        if (curator.distanceTo(this.player.position) > 3.0) return null;
        const donatable = this.inventory.all.find((item) => SPECIES_BY_ID.has(item.defId) && !this.museum.has(item.defId));
        if (!donatable) return null;
        return {
          id: 'museum.donate',
          kind: 'donate',
          label: 'Donate',
          detail: donatable.name,
          action: 'useTool',
          priority: 84,
          worldX: curator.x,
          worldY: 1.6,
          worldZ: curator.z,
          perform: () => this.donate(donatable.defId),
        } satisfies InteractionOption;
      });
      this.interactions.register('collection', () => {
        const curator = world(interior.anchors.curator);
        if (curator.distanceTo(this.player.position) > 4.2) return null;
        return {
          id: 'museum.collection',
          kind: 'read',
          label: 'Collection',
          // Shares the tool button with donating, which outranks it — so the
          // same press donates when you are carrying something new and opens
          // the ledger when you are not.
          action: 'useTool',
          priority: 20,
          worldX: curator.x,
          worldY: 2.4,
          worldZ: curator.z,
          perform: () => openMuseum(this.panelContext()),
        } satisfies InteractionOption;
      });
    }

    if (interior.id === 'shop') {
      anchorPrompt('counter', 'Browse', 82, () => openShop(this.panelContext()), 3.0);
    }

    if (interior.id === 'townhall') {
      anchorPrompt('desk', 'Island progress', 82, () => openTownHall(this.panelContext()), 3.0);
      anchorPrompt('model', 'Workbench', 80, () => openCrafting(this.panelContext()), 2.6);
    }
  }

  private updateInteractions(dt: number, paused: boolean): void {
    this.interactions.setEnabled(
      !paused && !this.dialogue.isOpen && !this.fishing.isActive && this.mode !== 'decorating' && this.mode !== 'building',
    );
    this.interactions.update(dt, {
      playerX: this.player.position.x,
      playerY: this.player.position.y,
      playerZ: this.player.position.z,
      hour: this.time.hour,
      day: this.time.day,
    });
    this.hud.positionPrompts(this.renderer.camera, this.container.clientWidth, this.container.clientHeight);
  }

  // --- Gameplay actions ----------------------------------------------------

  private shakeTree(treeId: string): void {
    const tree = this.foliage.trees.find((t) => t.id === treeId);
    if (!tree) return;
    this.foliage.shakeTree(tree);
    this.player.performAction('gatherFruit', 1.1, false);
    this.bus.emit('audio:sfx', { id: 'tool.shake' });
    this.particles.burst('leaves', new Vector3(tree.x, tree.y + 4, tree.z), 1);

    const fruitReady = tree.hasFruit && this.time.day - tree.harvestedOnDay >= 3;
    window.setTimeout(() => {
      if (fruitReady) {
        tree.harvestedOnDay = this.time.day;
        this.foliage.refreshFruit(this.time.day);
        for (let i = 0; i < 2; i++) {
          this.drops.spawn('fruit.orchardPear', new Vector3(tree.x, tree.y + 3.4, tree.z), () =>
            !!this.inventory.addById('fruit.orchardPear', { day: this.time.day }),
          );
        }
      } else if (Math.random() < 0.45) {
        this.drops.spawn('mat.wood', new Vector3(tree.x, tree.y + 3, tree.z), () => {
          this.materials.wood += 1;
          this.quests.record('gather', 1);
          return true;
        });
      } else if (Math.random() < 0.25 && this.time.hour >= 6 && this.time.hour < 20) {
        // A bug sometimes falls out — the reason to shake trees you have already
        // stripped. It has to be one that lives in this tree's region, or the
        // net's whole geography could be shortcut by shaking a town broadleaf.
        const local = this.bugsActiveIn(regionAt(tree.x, tree.z), this.time.hour);
        if (local.length > 0) {
          const bug = local[Math.floor(Math.random() * local.length)];
          this.onCatch(bug.id, undefined, 'Fell out of the tree');
        } else {
          this.uiRoot.toast('Just leaves this time.', 'neutral');
        }
      } else {
        this.uiRoot.toast('Just leaves this time.', 'neutral');
      }
      this.save.markDirty();
    }, 520);
  }

  private useNode(nodeId: string): void {
    const node = this.props.gatherNodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.kind === 'forage' && node.defId) {
      const defId = node.defId;
      node.harvestedOnDay = this.time.day;
      this.props.refreshNodes(this.time.day);
      this.player.performAction('pick', 1.0, false);
      this.particles.burst('leaves', new Vector3(node.x, node.y + 0.4, node.z), 0.5);
      this.bus.emit('audio:sfx', { id: 'item.harvest' });
      // Two at a time: one clump is a trip, and the recipes take pairs.
      const amount = 1 + (Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < amount; i++) {
        this.drops.spawn(defId, new Vector3(node.x, node.y + 0.5, node.z), () =>
          !!this.inventory.addById(defId, { day: this.time.day }),
        );
      }
      this.save.markDirty();
      return;
    }

    if (node.kind === 'shell') {
      node.harvestedOnDay = this.time.day;
      this.props.refreshNodes(this.time.day);
      this.player.performAction('pick', 1.0, false);
      const sea = weightedPick(
        SEA_CREATURES.filter((s) => s.habitat === 'beach' || s.habitat === 'shallow'),
        [100, 40],
      ) ?? SEA_CREATURES[0];
      this.particles.burst('dust', new Vector3(node.x, node.y + 0.2, node.z), 0.5);
      this.onCatch(sea.id, undefined, 'Found on the sand');
      return;
    }

    // Rock and dig spots reuse the tool swings so the animation always matches.
    this.player.setTool(node.kind === 'rock' ? 'axe' : 'shovel', false);
    this.tryUseTool();
  }

  /**
   * True for anything the shut orchard gate is supposed to be keeping from the
   * player.
   *
   * The hedge stops them walking in, but reach does not stop at the hedge: a
   * pear tree planted against it is within the shake prompt's radius from
   * outside, and a net swung over the gate would land on a Blossom Moth. The
   * gate is the region's whole premise, so it gates what is in the region,
   * not just the way in.
   */
  private isSealed(x: number, z: number): boolean {
    return !this.props.orchardGate.isOpen && isInRegion('orchard', x, z);
  }

  /** Unlocks the orchard for good. */
  private openOrchardGate(): void {
    if (this.props.orchardGate.isOpen) return;
    if (this.quests.storyStage < 1) return;
    this.props.setOrchardOpen(true);
    this.player.performAction('pick', 1.0, false);
    this.bus.emit('audio:sfx', { id: 'ui.open' });
    this.uiRoot.showLocation('Secret Orchard', 'The gate gives, and stays given');
    this.uiRoot.toast('The brass key turns. The orchard is open.', 'rare');
    this.save.markDirty();
  }

  /**
   * The spyglass on the point. It reports what is out there right now rather
   * than reciting a fixed line, so it stays worth a look.
   */
  private useSpyglass(): void {
    this.player.performAction('pick', 0.9, false);
    this.bus.emit('audio:sfx', { id: 'ui.select' });
    const lines: string[] = [];
    if (this.townWorks.lighthouse) {
      lines.push(this.time.hour >= 19 || this.time.hour < 5
        ? 'The beam is turning. Something pale is circling it.'
        : 'The lamp room is dark, but the glass is clean.');
    } else {
      lines.push('The lamp room above you is still dark.');
    }
    lines.push(this.weather.current.precipitation > 0.2
      ? 'Rain on the water all the way out to the shelf.'
      : 'You can see the whole south beach, and somebody on the pier.');
    this.uiRoot.toast(lines[Math.floor(Math.random() * lines.length)], 'neutral');
  }

  private plantSeed(plotId: string): void {
    const plot = this.farm.plots.find((p) => p.id === plotId);
    if (!plot || this.seeds <= 0) return;
    if (!this.farm.plant(plot)) return;
    this.seeds -= 1;
    this.player.performAction('plant', 1.15, false);
    this.particles.burst('dust', new Vector3(plot.x, plot.y + 0.3, plot.z), 0.6);
    this.save.markDirty();
  }

  private harvestPlot(plotId: string): void {
    const plot = this.farm.plots.find((p) => p.id === plotId);
    if (!plot) return;
    const cropId = this.farm.harvest(plot);
    if (!cropId) return;
    this.player.performAction('pick', 1.0, false);
    this.particles.burst('sparkle', new Vector3(plot.x, plot.y + 0.6, plot.z), 0.7);
    this.drops.spawn(cropId, new Vector3(plot.x, plot.y + 0.6, plot.z), () => {
      if (!this.inventory.addById(cropId, { day: this.time.day })) return false;
      this.stats.harvested += 1;
      this.quests.record('harvest', 1);
      return true;
    });
    this.save.markDirty();
  }

  private donate(defId: string): void {
    const item = this.inventory.all.find((i) => i.defId === defId);
    if (!item) return;
    if (!this.museum.donate(defId)) {
      this.uiRoot.toast('Juniper already has one of those.', 'warn');
      return;
    }
    this.inventory.remove(item.uid);
    this.bus.emit('audio:sfx', { id: 'museum.donate' });
    this.player.celebrate();
    this.player.emoteBubble('sparkle', 1.4);
    // The piece lifts off the pedestal in a shower of light.
    const pedestal = this.activeInterior?.anchors.curator;
    const at = pedestal
      ? new Vector3(pedestal.x + INTERIOR_ORIGIN.x, 1.3, pedestal.z + INTERIOR_ORIGIN.z)
      : this.player.headPosition;
    this.particles.burst('sparkle', at, 1.6);
    this.particles.burst('petals', at, 0.6);
    this.quests.record('donate', 1);
    this.relationships.add('juniper', 6);

    const species = SPECIES_BY_ID.get(defId);
    this.uiRoot.toast(`${species?.name ?? 'It'} is on display now.`, 'rare', iconFor(defId, 64));
    this.save.markDirty();
    this.uiRoot.refresh('museum');
  }

  private talkTo(villagerId: string): void {
    const def = VILLAGERS_BY_ID.get(villagerId);
    if (!def) return;
    const villager = this.villagers.get(villagerId);
    const relationship = this.relationships.get(villagerId);

    // Hand over an outstanding request if the player is carrying it.
    if (relationship.request && !relationship.request.done && this.inventory.has(relationship.request.itemDefId)) {
      const wanted = getItemDef(relationship.request.itemDefId);
      this.inventory.removeOneOf(relationship.request.itemDefId);
      const reward = this.relationships.completeRequest(villagerId);
      this.addCoins(reward);
      this.villagers.markerFor(villagerId, false);
      villager?.react('celebrate');

      this.dialogue.open({
        speakerId: villagerId,
        speakerName: def.name,
        title: def.title,
        portrait: villagerPortrait(def.look, 'excited'),
        lines: [
          `The ${wanted?.name ?? 'thing'}! You actually remembered.`,
          `Here — ${reward} shells, and I mean it.`,
        ],
        hearts: this.relationships.hearts(villagerId),
        heartGained: true,
        onComplete: () => {
          this.player.endTalking();
          villager?.stopTalking();
        },
      });
      this.player.beginTalking(villager?.position.x ?? 0, villager?.position.z ?? 0);
      villager?.startTalking(this.player.position.x, this.player.position.z);
      return;
    }

    const seenToday = this.relationships.hasSpokenToday(villagerId, this.time.day);
    const result = this.relationships.talk(villagerId, this.time.day);
    if (result.firstToday) this.quests.record('talk', 1);

    const raining = this.weather.kind === 'rain' || this.weather.kind === 'storm';
    const lines = this.villagers.lineFor(def, this.time.hour, raining, seenToday);

    // Offer a request when they have one outstanding and the player lacks it.
    const openRequest = relationship.request && !relationship.request.done ? relationship.request : null;
    if (openRequest) {
      const wanted = getItemDef(openRequest.itemDefId);
      lines.push(`Actually — could you find me ${wanted?.name ?? 'something'}? I would pay ${openRequest.reward} for it.`);
    }

    this.dialogue.open({
      speakerId: villagerId,
      speakerName: def.name,
      title: def.title,
      portrait: villagerPortrait(def.look, result.gained ? 'excited' : 'happy'),
      lines,
      hearts: this.relationships.hearts(villagerId),
      heartGained: result.gained,
      onComplete: () => {
        this.player.endTalking();
        villager?.stopTalking();
      },
    });

    this.player.beginTalking(villager?.position.x ?? 0, villager?.position.z ?? 0);
    villager?.startTalking(this.player.position.x, this.player.position.z);
    if (result.gained) this.particles.burst('hearts', new Vector3(
      villager?.position.x ?? 0,
      (villager?.position.y ?? 0) + 1.9,
      villager?.position.z ?? 0,
    ), 1);
  }

  // --- Panels --------------------------------------------------------------

  /** Snapshot of state the UI panels read. Public so tooling can drive them. */
  panelContext(): PanelContext {
    return {
      ui: this.uiRoot,
      coins: this.coins,
      day: this.time.day,
      season: this.time.season,
      materials: this.materials,
      seeds: this.seeds,
      toolLevels: this.player.toolLevels as unknown as Record<string, number>,
      bagLevel: this.inventory.bagLevel,
      homeLevel: this.homeLevel,
      houseStyleId: this.houseStyleId,
      ownedFurniture: this.ownedFurniture,
      ownedStyles: this.ownedStyles,
      placedFurniture: this.furnishing.pieces.map((p) => ({ defId: p.defId })),
      look: this.look,
      townRating: this.lastTownRating,
      townWorks: this.townWorks,
      storyStage: this.quests.storyStage,
      cooked: this.stats.cooked,
      stats: this.stats,

      inventoryStacks: (sort, filter) => this.inventory.stacks(sort as never, filter),
      inventoryCount: this.inventory.count,
      inventoryCapacity: this.inventory.capacity,

      museumHas: (defId) => this.museum.has(defId),
      museumProgress: () => this.museum.allProgress(),

      friendship: (id) => this.relationships.friendship(id),
      requestFor: (id) => this.relationships.get(id).request ?? null,
      scheduleLabel: (id) => this.villagers.get(id)?.scheduleLabel ?? '',

      shopStock: () => this.shop.stockFor(this.time.day, this.ownedFurniture),

      sell: (stackKey, quantity) => this.sellStack(stackKey, quantity),
      sellAllDuplicates: () => this.sellDuplicates(),
      buy: (defId, price, kind) => this.buy(defId, price, kind),
      donate: (defId) => this.donate(defId),
      toggleFavorite: (uid) => this.inventory.toggleFavorite(uid),
      craft: (recipeId) => this.craft(recipeId),
      upgradeBag: () => this.upgradeBag(),
      cook: (recipeId) => this.cook(recipeId),
      buildWork: (id) => this.buildWork(id),
      upgradeHome: () => this.upgradeHome(),
      setHouseStyle: (styleId) => this.setHouseStyle(styleId),
      setLook: (look) => {
        this.look = look;
        this.player.setLook(look);
        this.save.markDirty();
      },
      placeFurniture: (defId) => {
        if (this.activeInterior?.id !== 'home') {
          this.uiRoot.toast('Place furniture from inside your cottage.', 'warn');
          return;
        }
        const already = this.furnishing.pieces.find((p) => p.defId === defId);
        if (already) {
          this.furnishing.remove(already.uid);
          this.uiRoot.toast('Put away.', 'neutral');
        } else {
          this.furnishing.place(defId);
        }
        this.save.markDirty();
      },
      enterDecorateMode: () => this.enterDecorating(),
      drawMap: (canvas) => drawIslandMap(canvas, this.player.position, { works: this.townWorks }),
    };
  }

  private openSettingsPanel(): void {
    openSettings(this.uiRoot, {
      volumes: {
        master: this.settings.masterVolume,
        music: this.settings.musicVolume,
        sfx: this.settings.sfxVolume,
        ambience: this.settings.ambienceVolume,
      },
      quality: this.settings.quality,
      autoQuality: this.settings.autoQuality,
      cameraShake: this.settings.cameraShake,
      setVolume: (channel, value) => {
        if (channel === 'master') this.settings.masterVolume = value;
        if (channel === 'music') this.settings.musicVolume = value;
        if (channel === 'sfx') this.settings.sfxVolume = value;
        if (channel === 'ambience') this.settings.ambienceVolume = value;
        this.applyVolumes();
        this.save.markDirty();
      },
      setQuality: (value) => {
        this.settings.quality = value as QualityLevel;
        this.renderer.applyQuality(this.settings.quality);
        this.save.markDirty();
      },
      setAutoQuality: (value) => {
        this.settings.autoQuality = value;
        this.renderer.autoQuality = value;
      },
      setCameraShake: (value) => {
        this.settings.cameraShake = value;
        this.cameraRig.shakeEnabled = value;
        this.save.markDirty();
      },
      saveNow: () => {
        if (this.saveIfPlaying()) this.uiRoot.toast('Island saved.', 'good');
      },
      quitToTitle: () => {
        this.saveIfPlaying();
        this.uiRoot.closeAll();
        this.mode = 'title';
        this.hud.setVisible(false);
        this.player.group.visible = false;
        this.title.show();
        this.presentTitleVista();
      },
    });
  }

  // --- Economy -------------------------------------------------------------

  private sellStack(stackKey: string, quantity: number): void {
    const stacks = this.inventory.stacks('category', 'all');
    const stack = stacks.find((s) => s.key === stackKey);
    if (!stack) return;
    let earned = 0;
    let sold = 0;
    for (const item of stack.items.slice(0, quantity)) {
      if (item.favorite) continue;
      this.inventory.remove(item.uid);
      earned += item.value;
      sold += 1;
    }
    if (sold === 0) {
      this.uiRoot.toast('That one is locked.', 'warn');
      return;
    }
    this.addCoins(earned);
    this.stats.totalSold += sold;
    this.quests.record('sell', sold);
    this.bus.emit('audio:sfx', { id: 'money.sale' });
    this.uiRoot.toast(`Sold ${sold} × ${stack.name} for ${earned}.`, 'good');
  }

  private sellDuplicates(): void {
    const stacks = this.inventory.stacks('category', 'all');
    let earned = 0;
    let sold = 0;
    for (const stack of stacks) {
      // Keep one of everything, and never sell a locked item.
      const sellable = stack.items.filter((i) => !i.favorite).slice(1);
      for (const item of sellable) {
        this.inventory.remove(item.uid);
        earned += item.value;
        sold += 1;
      }
    }
    if (sold === 0) {
      this.uiRoot.toast('Nothing spare to sell.', 'neutral');
      return;
    }
    this.addCoins(earned);
    this.stats.totalSold += sold;
    this.quests.record('sell', sold);
    this.bus.emit('audio:sfx', { id: 'money.sale' });
    this.uiRoot.toast(`Sold ${sold} duplicates for ${earned}.`, 'good');
  }

  private buy(defId: string, price: number, kind: string): void {
    if (this.coins < price) {
      this.uiRoot.toast('Not enough shells.', 'warn');
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return;
    }
    this.addCoins(-price);
    this.bus.emit('audio:sfx', { id: 'money.sale' });

    if (kind === 'seed') {
      this.seeds += 5;
      this.uiRoot.toast('Five seed packets.', 'good');
    } else if (kind === 'furniture') {
      this.ownedFurniture.push(defId);
      this.uiRoot.toast(`${FURNITURE_BY_ID.get(defId)?.name ?? 'It'} is yours.`, 'good', iconFor(defId, 64));
    } else {
      if (!this.ownedStyles.includes(defId)) this.ownedStyles.push(defId);
      this.setHouseStyle(defId);
    }
    this.save.markDirty();
  }

  private craft(recipeId: string): void {
    const recipe = CRAFTING.find((r) => r.id === recipeId);
    if (!recipe?.tool) return;
    const level = this.player.toolLevels[recipe.tool as ToolId] ?? 1;
    if (level >= (recipe.maxLevel ?? 3)) return;
    const cost = recipe.cost(level);
    if (
      this.materials.wood < cost.wood ||
      this.materials.stone < cost.stone ||
      this.materials.fiber < cost.fiber ||
      this.coins < cost.coins
    ) {
      this.uiRoot.toast('Not enough materials.', 'warn');
      return;
    }
    this.materials.wood -= cost.wood;
    this.materials.stone -= cost.stone;
    this.materials.fiber -= cost.fiber;
    this.addCoins(-cost.coins);
    this.player.toolLevels[recipe.tool as ToolId] = level + 1;
    if (this.player.tool === recipe.tool) this.player.setTool(recipe.tool as ToolId, false);
    this.bus.emit('audio:sfx', { id: 'tool.mine' });
    this.uiRoot.toast(`${recipe.name} upgraded to level ${level + 1}.`, 'good');
    this.save.markDirty();
  }

  private upgradeBag(): void {
    const level = this.inventory.bagLevel;
    if (level >= 2) return;
    const cost = 300 + level * 350;
    const fiber = 4 + level * 3;
    if (this.materials.fiber < fiber || this.coins < cost) {
      this.uiRoot.toast('Not enough fiber or shells.', 'warn');
      return;
    }
    this.materials.fiber -= fiber;
    this.addCoins(-cost);
    this.inventory.bagLevel = level + 1;
    this.uiRoot.toast(`Backpack expanded to ${this.inventory.capacity} slots.`, 'good');
    this.save.markDirty();
  }

  private cook(recipeId: string): void {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;
    if (this.stats.cooked < recipe.unlockAfterCooked) return;

    // Check before consuming so a partial recipe never eats ingredients.
    const consumed: string[] = [];
    const used = new Set<string>();
    for (const need of recipe.needs) {
      const candidate = this.inventory.all.find((i) => i.category === need && !i.favorite && !used.has(i.uid));
      if (!candidate) {
        this.uiRoot.toast(`Needs ${recipe.needs.join(' + ')}.`, 'warn');
        return;
      }
      used.add(candidate.uid);
      consumed.push(candidate.uid);
    }
    for (const uid of consumed) this.inventory.remove(uid);

    const item = this.inventory.addById(recipe.resultItemId, { day: this.time.day });
    this.stats.cooked += 1;
    this.quests.record('cook', 1);
    this.bus.emit('audio:sfx', { id: 'item.harvest' });
    if (item) this.uiRoot.toast(`Cooked ${item.name}.`, 'good', iconFor(item.defId, 64));
    this.save.markDirty();
  }

  private buildWork(id: 'bridge' | 'stairs' | 'lighthouse'): void {
    const work = PUBLIC_WORKS.find((w) => w.id === id);
    if (!work || this.townWorks[id]) return;
    if (
      this.coins < work.cost.coins ||
      this.materials.wood < work.cost.wood ||
      this.materials.stone < work.cost.stone
    ) {
      this.uiRoot.toast('Not enough shells or materials.', 'warn');
      return;
    }
    this.addCoins(-work.cost.coins);
    this.materials.wood -= work.cost.wood;
    this.materials.stone -= work.cost.stone;
    this.townWorks[id] = true;
    this.uiRoot.toast(`${work.name} is finished.`, 'rare');
    this.bus.emit('audio:sfx', { id: 'quest.complete' });
    this.save.markDirty();
  }

  private upgradeHome(): void {
    if (this.homeLevel >= 4) return;
    const cost = this.homeLevel * 2400;
    if (this.coins < cost) {
      this.uiRoot.toast('Not enough shells.', 'warn');
      return;
    }
    this.addCoins(-cost);
    this.homeLevel += 1;
    const layout = homeLayoutFor(this.homeLevel);
    this.furnishing.setBounds({
      minX: -layout.gridHalfW + 0.6,
      maxX: layout.gridHalfW - 0.6,
      minZ: -layout.gridHalfD + 0.6,
      maxZ: layout.gridHalfD - 1.2,
    });
    this.uiRoot.toast('The cottage has grown.', 'rare');
    this.save.markDirty();

    // Rebuild the room if the player is standing in it.
    if (this.activeInterior?.id === 'home') void this.enterBuilding('playerHome');
  }

  private setHouseStyle(styleId: string): void {
    const style = HOUSE_STYLES_BY_ID.get(styleId);
    if (!style) return;
    // The Home panel reaches this directly, so ownership is checked here rather
    // than in the UI: otherwise every paid colourway applies for nothing.
    if (style.price > 0 && !this.ownedStyles.includes(styleId)) {
      this.buy(styleId, style.price, 'houseStyle');
      return;
    }
    this.houseStyleId = styleId;
    this.buildings.applyHouseStyle(styleId);
    this.uiRoot.toast('Your cottage has a new coat.', 'good');
    this.save.markDirty();
  }

  // --- Presentation --------------------------------------------------------

  private updateAudioMix(): void {
    if (!this.audio.isReady) return;
    const indoors = this.mode === 'interior' || this.mode === 'decorating';
    const weather = this.weather.current;
    const night = this.time.isNight;

    if (indoors) {
      this.audio.setUnderwater(0);
      this.audio.setAmbience('ocean', 0.05);
      this.audio.setAmbience('wind', 0.04);
      this.audio.setAmbience('rain', weather.precipitation * 0.2);
      this.audio.setAmbience('insects', 0);
      this.audio.setAmbience('birds', 0);
      this.audio.setAmbience('interior', this.activeInterior?.ambience === 'museum' ? 0 : 0.7);
      this.audio.setAmbience('museum', this.activeInterior?.ambience === 'museum' ? 0.8 : 0);
      return;
    }

    // Surf gets louder the closer the player is to open water.
    const depthAhead = Math.max(
      waterDepth(this.player.position.x, this.player.position.z + 8),
      waterDepth(this.player.position.x, this.player.position.z - 8),
      waterDepth(this.player.position.x + 8, this.player.position.z),
      waterDepth(this.player.position.x - 8, this.player.position.z),
    );
    const nearWater = clamp01(depthAhead / 2.5);
    const coastal = clamp01(1 - Math.abs(this.player.position.z - 45) / 90);

    this.audio.setAmbience('ocean', Math.max(nearWater, coastal * 0.55));
    this.audio.setAmbience('wind', 0.2 + weather.wind * 0.55);
    this.audio.setAmbience('rain', weather.precipitation);
    this.audio.setAmbience('insects', night && weather.precipitation < 0.2 ? 0.5 : 0);
    this.audio.setAmbience('birds', !night && weather.precipitation < 0.3 ? 0.4 : 0);
    this.audio.setAmbience('interior', 0);
    this.audio.setAmbience('museum', 0);
    // Everything above the surface arrives through several metres of water.
    this.audio.setUnderwater(this.underwater);

    this.updateMusic();
  }

  private updateMusic(): void {
    if (this.mode === 'title') return;
    let track: string;
    if (this.activeInterior) {
      track = this.activeInterior.music;
    } else if (this.weather.kind === 'rain' || this.weather.kind === 'storm') {
      track = 'music.rain';
    } else if (this.time.isNight) {
      track = 'music.night';
    } else if (this.player.position.z > 28) {
      track = 'music.beach';
    } else if (this.time.hour >= 17) {
      track = 'music.townEvening';
    } else {
      track = 'music.townDay';
    }
    if (this.audio.currentMusicId !== track) this.audio.playMusic(track);
  }

  private updateHud(): void {
    const rating = this.quests.rating({
      donated: this.museum.totalDonated,
      totalSpecies: ALL_SPECIES.length,
      friendshipTotal: this.relationships.total,
      // What is planted *now*, not what has ever been planted: an island the
      // player has stripped back should read as stripped back.
      flowersPlanted: this.landscaping.greeneryCount,
      cropsHarvested: this.stats.harvested,
      worksBuilt: Object.values(this.townWorks).filter(Boolean).length,
      homeLevel: this.homeLevel,
      furniturePlaced: this.furnishing.pieces.length,
    });

    if (rating !== this.lastTownRating) {
      this.lastTownRating = rating;
      const story = this.quests.checkStory(rating, this.relationships.friendship('pip'), this.townWorks);
      if (story.advanced) {
        if (story.bonus) this.addCoins(story.bonus);
        this.uiRoot.toast(story.text, 'rare');
      }
    }

    this.hud.update({
      day: this.time.day,
      season: this.time.season,
      timeLabel: this.time.format(),
      weather: this.weather.kind,
      weatherLabel: this.weather.label,
      coins: this.coins,
      questTitle: this.quests.active.title,
      questText: this.quests.active.text,
      questProgress: this.quests.progress,
      questGoal: this.quests.active.goal,
      tool: this.player.tool,
      toolLevels: this.player.toolLevels as unknown as Record<string, number>,
      quiet: this.dialogue.isOpen || this.catchCard.isOpen || this.mode === 'decorating',
    });

    this.uiRoot.setPerf([
      `${(1000 / Math.max(0.001, this.renderer.frameMs)).toFixed(0)} fps  ${this.renderer.frameMs.toFixed(1)} ms`,
      `quality ${this.renderer.quality}${this.renderer.autoQuality ? ' (auto)' : ''}`,
      `draws ${this.renderer.info.calls}  tris ${(this.renderer.info.triangles / 1000).toFixed(0)}k`,
      `particles ${this.particles.activeCount}  drops ${this.drops.activeCount}`,
      `mode ${this.mode}  ${this.time.format()}`,
    ]);
  }

  // --- Utilities -----------------------------------------------------------

  /**
   * True once a slot has actually been loaded or started. Everything that
   * writes to storage checks this: at the title screen the game still holds a
   * default state pointed at slot 1, and persisting that would erase whatever
   * save is already in that slot.
   */
  get hasActiveSession(): boolean {
    return this.mode !== 'title';
  }

  /** Writes the current slot, unless the game is still on the title screen. */
  saveIfPlaying(): boolean {
    if (!this.hasActiveSession) return false;
    this.save.write(this.snapshot());
    return true;
  }

  /** Named world anchors, exposed for tooling and the map. */
  get landmarks(): typeof LANDMARKS {
    return LANDMARKS;
  }

  /** Moves the player to a landmark. Used by the map and by debug tooling. */
  warpTo(landmarkId: string): void {
    const target = LANDMARKS[landmarkId];
    if (!target) return;
    // A line left in the water would stretch across the island behind us.
    if (this.fishing.isActive) this.fishing.reelIn(this.player);
    this.player.teleport(target.x, target.z, this.player.facing);
    this.cameraRig.snapTo(this.player.position, this.player.facing + Math.PI);
  }

  get playerLook(): CharacterLook {
    return this.look;
  }

  playerPortraitUrl(): string {
    return playerPortrait(this.look);
  }

  toolList(): typeof TOOLS {
    return TOOLS;
  }

  dispose(): void {
    this.running = false;
    this.cancelDiveCards();
    this.input.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.creek.dispose();
    this.foliage.dispose();
    this.props.dispose();
    this.scatter.dispose();
    this.wildlife.dispose();
    this.buildings.dispose();
    this.fishSchools.dispose();
    this.reef.dispose();
    this.insects.dispose();
    this.landscaping.dispose();
    this.farm.dispose();
    this.particles.dispose();
    this.weatherFX.dispose();
    this.underwaterFX.dispose();
    this.villagers.dispose();
    this.player.dispose();
    this.renderer.dispose();
  }
}

/** Weighted random pick. Returns the first entry if weights do not resolve. */
function weightedPick<T>(items: T[], weights: number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let pick = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i] ?? 0;
    if (pick <= 0) return items[i];
  }
  return items[0];
}
