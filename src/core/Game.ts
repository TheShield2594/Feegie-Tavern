import { Box3, Color, Group, Vector3 } from 'three';
import { AudioSystem } from '@/audio/AudioSystem';
import { EventBus } from './EventBus';
import { InputSystem } from '@/input/InputSystem';
import { CameraRig } from '@/rendering/CameraRig';
import { LightingRig } from '@/rendering/LightingRig';
import { ParticleSystem } from '@/rendering/Particles';
import { Renderer, type QualityLevel } from '@/rendering/Renderer';
import { Sky } from '@/rendering/Sky';
import { WeatherFX } from '@/rendering/WeatherFX';
import { registerShaderChunks, updateSharedUniforms } from '@/rendering/materials';
import { SEASON_TINT } from '@/rendering/palette';
import { TimeSystem } from '@/time/TimeSystem';
import { WeatherSystem } from '@/time/WeatherSystem';
import { Terrain } from '@/world/Terrain';
import { Water } from '@/world/Water';
import { Foliage } from '@/world/Foliage';
import { Props } from '@/world/Props';
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
import { ISLAND_HALF, LANDMARKS, SEA_LEVEL, terrainHeight, waterDepth } from '@/world/heightfield';
import { drawIslandMap } from '@/world/Minimap';
import { Player } from '@/player/Player';
import { TOOLS, type ToolId } from '@/player/Tools';
import { VillagerManager } from '@/npc/VillagerManager';
import { Inventory, rollSize } from '@/inventory/Inventory';
import { Museum } from '@/museum/Museum';
import { FishSchools } from '@/fishing/FishSchools';
import { FishingSystem } from '@/fishing/FishingSystem';
import { Farm } from '@/farming/Farm';
import { DropSystem } from '@/gathering/DropSystem';
import { InteractionSystem } from '@/interactions/InteractionSystem';
import type { InteractionOption } from '@/interactions/types';
import { QuestSystem } from '@/quests/QuestSystem';
import { Relationships } from '@/relationships/Relationships';
import { ShopSystem } from '@/shops/ShopSystem';
import { HomeFurnishing } from '@/housing/HomeFurnishing';
import { SaveSystem, createNewSave } from '@/save/SaveSystem';
import type { SaveDataV5 } from '@/save/schema';
import { DEFAULT_LOOK, type CharacterLook } from '@/data/clothing';
import { FURNITURE_BY_ID, HOUSE_STYLES_BY_ID } from '@/data/furniture';
import { CRAFTING, RECIPES } from '@/data/recipes';
import { PUBLIC_WORKS } from '@/data/quests';
import { VILLAGERS, VILLAGERS_BY_ID } from '@/data/villagers';
import { ALL_SPECIES, BUGS, FOSSILS, SEA_CREATURES, SPECIES_BY_ID } from '@/data/species';
import { getItemDef } from '@/data/items';
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

/** Interiors are built far from the island so both can exist in one scene. */
const INTERIOR_ORIGIN = new Vector3(1000, 0, 0);

type Mode = 'title' | 'exterior' | 'interior' | 'decorating';

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

  readonly time: TimeSystem;
  readonly weather: WeatherSystem;

  private exteriorRoot = new Group();
  private interiorRoot = new Group();
  private terrain!: Terrain;
  private water!: Water;
  private foliage!: Foliage;
  private props!: Props;
  private buildings!: Buildings;
  private fishSchools!: FishSchools;
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
  private stats = { totalCaught: 0, totalSold: 0, harvested: 0, flowersPlanted: 0, cooked: 0, records: {} as Record<string, number> };
  private slot = 1;
  private playtime = 0;
  private lastTownRating = 1;
  private lastSeason = 'Spring';
  private lastMinutes = 0;

  private elapsed = 0;
  private running = false;
  private lastFrame = 0;

  constructor(private container: HTMLElement) {
    registerShaderChunks();

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

    this.terrain = new Terrain({ resolution: 300 });
    this.water = new Water();
    this.foliage = new Foliage(this.renderer.profile.foliageDensity);
    this.props = new Props();
    this.buildings = new Buildings();
    this.fishSchools = new FishSchools();
    this.farm = new Farm(this.bus);
    this.drops = new DropSystem(this.bus);

    this.exteriorRoot.add(
      this.terrain.mesh,
      this.water.mesh,
      this.foliage.group,
      this.props.group,
      this.buildings.group,
      this.fishSchools.group,
      this.farm.group,
      this.drops.group,
    );

    // Navigation avoids buildings and solid props.
    const obstacles = [
      ...this.buildings.colliders.map((c) => ({ x: c.x, z: c.z, radius: Math.max(c.halfW, c.halfD) + 0.8 })),
      ...this.props.colliders,
    ];
    this.villagers = new VillagerManager(this.bus, obstacles);
    this.exteriorRoot.add(this.villagers.group);

    this.player = new Player(this.bus, this.look);
    scene.add(this.player.group);

    this.fishing = new FishingSystem(this.bus, this.particles, this.fishSchools);
    scene.add(this.fishing.group);

    scene.add(this.particles.normalPoints, this.particles.additivePoints, this.weatherFX.group);
    this.interiorRoot.add(this.furnishing.group);

    this.cameraRig.bounds = new Box3(
      new Vector3(-ISLAND_HALF + 6, -20, -ISLAND_HALF + 6),
      new Vector3(ISLAND_HALF - 6, 60, ISLAND_HALF - 6),
    );
    this.cameraRig.occluders = [...this.buildings.occluders, ...this.foliage.occluders];

    this.terrain.applySeason('Spring');
    this.foliage.applySeason('Spring');
  }

  private wireEvents(): void {
    this.bus.on('audio:sfx', ({ id, volume, rate }) => this.audio.playSound(id, { volume, rate }));
    this.bus.on('audio:music', ({ id }) => this.audio.playMusic(id));

    this.bus.on('ui:catchCard', (payload) => this.catchCard.show(payload));

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
    // Clamp so a backgrounded tab does not fast-forward the island.
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
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
    this.villagers.snapToSchedule(17);
    this.audio.playMusic('music.title');
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

  private applySave(data: SaveDataV5): void {
    this.time.load(data.clock.day, data.clock.minutes);
    this.lastMinutes = this.time.minutes;
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
    this.buildings.applyHouseStyle(this.houseStyleId);

    this.farm.load(data.farm.plots);
    for (const entry of data.world.gatherables) {
      const node = this.props.gatherNodes.find((n) => n.id === entry.id);
      if (node) node.harvestedOnDay = entry.harvestedOnDay;
    }
    this.props.refreshNodes(this.time.day);
    this.foliage.refreshFruit(this.time.day);
    this.townWorks = { ...data.world.townWorks };
    this.gardens = data.world.gardens.map((g) => ({ ...g }));

    Object.assign(this.settings, {
      masterVolume: data.settings.masterVolume,
      musicVolume: data.settings.musicVolume,
      sfxVolume: data.settings.sfxVolume,
      ambienceVolume: data.settings.ambienceVolume,
      quality: data.settings.quality,
      cameraShake: data.settings.cameraShake,
    });
    this.cameraRig.shakeEnabled = this.settings.cameraShake;

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
    this.lastSeason = season;
  }

  private townWorks = { bridge: false, stairs: false, lighthouse: false };
  private gardens: { x: number; z: number; color: string }[] = [];

  snapshot(): SaveDataV5 {
    return {
      version: 5,
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
        ownedFurniture: [...this.ownedFurniture],
        placed: this.furnishing.serialize(),
      },
      farm: { plots: this.farm.serialize() },
      world: {
        gardens: this.gardens.map((g) => ({ ...g })),
        gatherables: this.props.gatherNodes
          .filter((n) => n.harvestedOnDay > 0)
          .map((n) => ({ id: n.id, harvestedOnDay: n.harvestedOnDay })),
        townWorks: { ...this.townWorks },
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
    this.updateWorld(dt, !paused);
    this.updateInteractions(dt, paused);
    this.updateAudioMix();
    this.updateHud();

    this.save.tick(dt, () => this.snapshot());
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

    // Camera
    const orbit = -this.input.look.x + (this.input.isDown('cameraLeft') ? -1 : 0) + (this.input.isDown('cameraRight') ? 1 : 0);
    if (this.input.justPressed('zoomIn')) this.cameraRig.nudgeZoom(-0.16);
    if (this.input.justPressed('zoomOut')) this.cameraRig.nudgeZoom(0.16);
    this.cameraRig.update(dt, this.player.position, this.player.velocity, orbit);
  }

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
      circles: this.props.colliders,
      boxes: this.buildings.colliders,
    };
  }

  private updateWorld(dt: number, advance: boolean): void {
    const time = this.time.snapshot();
    const weather = this.weather.current;
    const indoors = this.mode === 'interior' || this.mode === 'decorating';

    const seasonTint = new Color(SEASON_TINT[time.season]?.grass ?? '#8ecb6a');
    updateSharedUniforms(this.elapsed, weather.wind, this.weather.wetness, seasonTint);

    const lightingOutput = this.lighting.update(
      time,
      weather,
      this.weather.lightningFlash,
      this.player.position,
      indoors,
    );
    this.lighting.setShadowQuality(this.renderer.profile);
    this.renderer.setGrade(lightingOutput);
    this.renderer.renderer.toneMappingExposure = lightingOutput.exposure;
    this.renderer.setBloom(lightingOutput.bloom);

    const camera = this.renderer.camera;
    this.sky.follow(camera.position.x, 0, camera.position.z);
    this.sky.update(this.elapsed);

    // Indoors the sky dome would show through the open ceiling, so swap it for
    // a plain backdrop and let the room read as a lit model.
    this.sky.mesh.visible = !indoors;
    if (indoors) this.renderer.renderer.setClearColor(0x1b2028, 1);

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
      this.foliage.update(dt, this.player.position.x, this.player.position.z);
      this.foliage.setGrassDistance(this.renderer.profile.grassDistance);
      this.props.update(dt, lightingOutput.darkness, this.elapsed);
      this.buildings.update(dt, lightingOutput.darkness, this.townWorks.lighthouse, this.time.hour);
      this.fishSchools.update(dt, this.elapsed, camera.position.x, camera.position.z);
      this.farm.update(dt);
      if (advance) this.villagers.update(dt, this.time.hour, this.player.position);
      this.drops.update(dt, this.player.position, (x, z) => terrainHeight(x, z));
    } else {
      this.updateInteriorWalls(camera.position);
      this.activeInterior?.update?.(dt, this.elapsed);
      this.furnishing.setLightLevel(clamp01(lightingOutput.darkness * 1.6 + 0.35));
      this.drops.update(dt, this.player.position, () => 0);
    }

    this.weatherFX.update(dt, weather, camera.position, lightingOutput.darkness, indoors, time.season);
    this.particles.update(dt);

    if (time.season !== this.lastSeason) {
      this.lastSeason = time.season;
      this.terrain.applySeason(time.season);
      this.foliage.applySeason(time.season);
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
    if (this.input.justPressed('cancel') && !this.uiRoot.isPanelOpen) {
      if (this.dialogue.isOpen) this.dialogue.close();
      else if (this.fishing.isActive) this.fishing.reelIn(this.player);
      else if (this.mode === 'decorating') this.exitDecorating();
    }
  }

  private handleGameplayInput(dt: number): void {
    void dt;

    if (this.mode === 'decorating') {
      this.updateDecorating();
      return;
    }

    if (this.input.justPressed('toolPrev')) this.player.cycleTool(-1);
    if (this.input.justPressed('toolNext')) this.player.cycleTool(1);

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
      if (!this.interactions.trigger()) {
        // Nothing to interact with; if the player is holding a rod at water, cast.
        this.tryUseTool();
      }
    }
    if (this.input.justPressed('useTool')) this.tryUseTool();
  }

  // --- Actions -------------------------------------------------------------

  private tryUseTool(): void {
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

  private resolveNetSwing(): void {
    const target = this.player.forwardPoint(1.6);
    // Bug catching is a soft-target action: anything nearby in season counts.
    const hour = this.time.hour;
    const candidates = BUGS.filter((bug) => {
      if (!bug.activeHours) return true;
      const [from, to] = bug.activeHours;
      return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
    });
    if (candidates.length === 0 || Math.random() > 0.5) {
      this.particles.burst('leaves', target, 0.4);
      this.uiRoot.toast('Nothing in the net this time.', 'neutral');
      return;
    }
    const weights = candidates.map((c) => (c.rarity === 'common' ? 100 : c.rarity === 'uncommon' ? 34 : 9));
    const bug = weightedPick(candidates, weights);
    this.particles.burst('sparkle', target, 0.8);
    this.onCatch(bug.id, undefined, 'Netted');
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
        });
      }
      return;
    }

    this.uiRoot.toast('Nothing to swing at here.', 'neutral');
  }

  /** Shared handler for anything that produces a species. */
  private onCatch(defId: string, sizeCm: number | undefined, headline: string): void {
    const species = SPECIES_BY_ID.get(defId);
    if (!species) return;
    const measured = sizeCm ?? rollSize(species);
    const item = this.inventory.addById(defId, { sizeCm: measured, day: this.time.day });
    if (!item) return;

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

    this.bus.emit('ui:catchCard', {
      item,
      headline,
      sizeCm: measured,
      isNewSpecies: isNew,
      isRecord,
    });
    this.save.markDirty();
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
    // Keep the furnishing group alive; it belongs to the game, not the room.
    if (this.furnishing.group.parent === this.activeInterior.group) {
      this.interiorRoot.add(this.furnishing.group);
    }
    this.interiorRoot.remove(this.activeInterior.group);
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

  // --- Interactions --------------------------------------------------------

  private registerExteriorInteractions(): void {
    this.interactions.clear();

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
      if (!tree) return null;
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
      if (!node) return null;
      const labels = { rock: 'Mine', digSpot: 'Dig', shell: 'Pick up', stick: 'Pick up' } as const;
      return {
        id: `node.${node.id}`,
        kind: node.kind === 'rock' ? 'mine' : node.kind === 'digSpot' ? 'dig' : 'gather',
        label: labels[node.kind],
        action: 'interact',
        priority: 50,
        worldX: node.x,
        worldY: node.y + 1.2,
        worldZ: node.z,
        perform: () => this.useNode(node.id),
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
      if (this.player.tool !== 'rod' || this.fishing.isActive) return null;
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
      anchorPrompt('curator', 'Talk to Juniper', 82, () => this.talkTo('juniper'), 3.0);
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
          action: 'inventory',
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
    this.interactions.setEnabled(!paused && !this.dialogue.isOpen && !this.fishing.isActive && this.mode !== 'decorating');
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
          this.drops.spawn('fruit.orchardPear', new Vector3(tree.x, tree.y + 3.4, tree.z), () => {
            this.inventory.addById('fruit.orchardPear', { day: this.time.day });
          });
        }
      } else if (Math.random() < 0.45) {
        this.drops.spawn('mat.wood', new Vector3(tree.x, tree.y + 3, tree.z), () => {
          this.materials.wood += 1;
          this.quests.record('gather', 1);
        });
      } else if (Math.random() < 0.25 && this.time.hour >= 6 && this.time.hour < 20) {
        // A bug sometimes falls out — the reason to shake trees you have already stripped.
        const bug = BUGS[Math.floor(Math.random() * BUGS.length)];
        this.onCatch(bug.id, undefined, 'Fell out of the tree');
      } else {
        this.uiRoot.toast('Just leaves this time.', 'neutral');
      }
      this.save.markDirty();
    }, 520);
  }

  private useNode(nodeId: string): void {
    const node = this.props.gatherNodes.find((n) => n.id === nodeId);
    if (!node) return;

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
      this.inventory.addById(cropId, { day: this.time.day });
      this.stats.harvested += 1;
      this.quests.record('harvest', 1);
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

  private panelContext(): PanelContext {
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
        this.save.write(this.snapshot());
        this.uiRoot.toast('Island saved.', 'good');
      },
      quitToTitle: () => {
        this.save.write(this.snapshot());
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
    if (!HOUSE_STYLES_BY_ID.has(styleId)) return;
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
      flowersPlanted: this.stats.flowersPlanted + this.gardens.length,
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

  /** Named world anchors, exposed for tooling and the map. */
  get landmarks(): typeof LANDMARKS {
    return LANDMARKS;
  }

  /** Moves the player to a landmark. Used by the map and by debug tooling. */
  warpTo(landmarkId: string): void {
    const target = LANDMARKS[landmarkId];
    if (!target) return;
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
    this.input.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.foliage.dispose();
    this.props.dispose();
    this.buildings.dispose();
    this.fishSchools.dispose();
    this.farm.dispose();
    this.particles.dispose();
    this.weatherFX.dispose();
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
