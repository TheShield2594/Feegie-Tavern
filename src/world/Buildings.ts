import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { HOUSE_STYLES_BY_ID } from '@/data/furniture';
import { clamp01, smoothstep } from '@/util/math';
import {
  gableRoofGeometry,
  hipRoofGeometry,
  makeDoor,
  makeLandscaping,
  makeSign,
  makeStreetLamp,
  makeWindow,
  roundedBoxGeometry,
} from './BuildingKit';
import { terrainHeight } from './heightfield';

export type BuildingId =
  | 'playerHome'
  | 'museum'
  | 'store'
  | 'townHall'
  | 'lighthouse'
  | 'home.pip'
  | 'home.mallow'
  | 'home.bruno';

export interface BuildingConfig {
  id: BuildingId;
  name: string;
  /** Sign text, omitted for homes that use a nameplate instead. */
  sign?: string;
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  wallHeight: number;
  roof: 'gable' | 'hip' | 'tower';
  roofColor: string;
  bodyColor: string;
  trimColor: string;
  doorColor: string;
  /** Interior scene to load when the player enters, or null for exterior-only. */
  interior: string | null;
  /** Whether the entrance is currently usable. */
  enterable: boolean;
  windows: number;
  awning?: boolean;
  lamps?: { x: number; z: number }[];
  hangingSign?: boolean;
}

export const BUILDINGS: BuildingConfig[] = [
  {
    id: 'playerHome',
    name: 'Your Cottage',
    x: -25, z: -20, rotation: 0.18,
    width: 7.4, depth: 6.2, wallHeight: 3.1,
    roof: 'gable', roofColor: PALETTE.roof.slate, bodyColor: PALETTE.plaster.cream,
    trimColor: PALETTE.plaster.white, doorColor: '#a8613f',
    interior: 'home', enterable: true, windows: 2,
    lamps: [{ x: 3.4, z: 4.2 }],
  },
  {
    id: 'museum',
    name: 'Cozy Cove Museum',
    sign: 'Museum',
    x: -6, z: -40, rotation: 0,
    width: 15.5, depth: 11, wallHeight: 5.4,
    roof: 'hip', roofColor: '#4a6b84', bodyColor: '#efe4cd',
    trimColor: '#f8f5ec', doorColor: '#3d4a6b',
    interior: 'museum', enterable: true, windows: 4,
    lamps: [{ x: -5.5, z: 7.5 }, { x: 5.5, z: 7.5 }],
  },
  {
    id: 'store',
    name: "Bruno's Boardwalk",
    sign: 'General Store',
    x: 22, z: -13, rotation: -0.22,
    width: 9.5, depth: 7.4, wallHeight: 3.8,
    roof: 'gable', roofColor: PALETTE.roof.terracotta, bodyColor: '#f6e3bc',
    trimColor: '#fff8e8', doorColor: '#6b4a2c',
    interior: 'shop', enterable: true, windows: 3,
    awning: true, hangingSign: true,
    lamps: [{ x: -5, z: 5 }],
  },
  {
    id: 'townHall',
    name: 'Town Hall',
    sign: 'Town Hall',
    x: 0, z: -54, rotation: 0,
    width: 12, depth: 9, wallHeight: 4.8,
    roof: 'hip', roofColor: '#5f7f56', bodyColor: '#f2e2c4',
    trimColor: '#fdf8ea', doorColor: '#4f6b45',
    interior: 'townhall', enterable: true, windows: 4,
    lamps: [{ x: -4.5, z: 6.5 }, { x: 4.5, z: 6.5 }],
  },
  {
    id: 'lighthouse',
    name: 'Cove Lighthouse',
    x: 42, z: -46, rotation: 0,
    width: 4.6, depth: 4.6, wallHeight: 15,
    roof: 'tower', roofColor: '#c9524a', bodyColor: '#f8f5ec',
    trimColor: '#c9524a', doorColor: '#3d4a6b',
    interior: null, enterable: false, windows: 2,
  },
  {
    id: 'home.pip',
    name: "Pip's House",
    x: 30, z: -34, rotation: -0.4,
    width: 6.4, depth: 5.6, wallHeight: 2.9,
    roof: 'gable', roofColor: '#c9784f', bodyColor: '#f4e0bc',
    trimColor: '#fff4e0', doorColor: '#7fa8c4',
    interior: 'npcHome', enterable: true, windows: 2,
  },
  {
    id: 'home.mallow',
    name: "Mallow's House",
    x: -46, z: -8, rotation: 0.6,
    width: 6.6, depth: 5.4, wallHeight: 3.0,
    roof: 'gable', roofColor: '#cf7da0', bodyColor: '#f7e6ea',
    trimColor: '#fffafb', doorColor: '#7fa86a',
    interior: 'npcHome', enterable: true, windows: 2,
  },
  {
    id: 'home.bruno',
    name: "Bruno's House",
    x: 44, z: 6, rotation: -1.1,
    width: 7.0, depth: 5.8, wallHeight: 3.0,
    roof: 'gable', roofColor: '#6f8d7e', bodyColor: '#e8dcc0',
    trimColor: '#f8f2e2', doorColor: '#b8543f',
    interior: 'npcHome', enterable: true, windows: 2,
  },
];

export interface BuildingInstance {
  config: BuildingConfig;
  group: Group;
  /** World-space point just outside the door, where the player stands to enter. */
  doorway: Vector3;
  /** Facing the player should adopt when leaving the interior. */
  doorFacing: number;
  doorLeaf: Group;
  private_windows: MeshStandardMaterial[];
  lampLights: PointLight[];
  lampGlass: MeshStandardMaterial[];
  beacon?: { light: SpotLight; glass: MeshStandardMaterial; pivot: Object3D };
  /** Collision footprint, axis-aligned in local space then rotated. */
  collider: { x: number; z: number; halfW: number; halfD: number; rotation: number };
}

/**
 * Builds and owns every exterior structure. Buildings are assembled from
 * BuildingKit parts at load time; the only per-frame work is driving window
 * and lamp emissives from the clock.
 */
export class Buildings {
  readonly group = new Group();
  readonly instances = new Map<BuildingId, BuildingInstance>();

  constructor() {
    this.group.name = 'Buildings';
    for (const config of BUILDINGS) {
      const instance = this.build(config);
      this.instances.set(config.id, instance);
      this.group.add(instance.group);
    }
  }

  private build(config: BuildingConfig): BuildingInstance {
    const group = new Group();
    group.name = `Building_${config.id}`;
    const ground = terrainHeight(config.x, config.z);
    group.position.set(config.x, ground, config.z);
    group.rotation.y = config.rotation;

    const windows: MeshStandardMaterial[] = [];
    const lampLights: PointLight[] = [];
    const lampGlass: MeshStandardMaterial[] = [];

    if (config.roof === 'tower') {
      const result = this.buildLighthouse(config, group, windows);
      return {
        config, group,
        doorway: this.doorwayWorldPosition(config, 3.4),
        doorFacing: config.rotation + Math.PI,
        doorLeaf: result.doorLeaf,
        private_windows: windows,
        lampLights, lampGlass,
        beacon: result.beacon,
        collider: { x: config.x, z: config.z, halfW: config.width / 2, halfD: config.depth / 2, rotation: config.rotation },
      };
    }

    // --- Foundation --------------------------------------------------------
    const plinth = new Mesh(
      roundedBoxGeometry(config.width + 0.5, 0.45, config.depth + 0.5, 0.2),
      createStylizedMaterial({ color: PALETTE.rock.base, roughness: 0.95, flatShading: true }),
    );
    plinth.position.y = -0.2;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    group.add(plinth);

    // --- Walls -------------------------------------------------------------
    const body = new Mesh(
      roundedBoxGeometry(config.width, config.wallHeight, config.depth, 0.28),
      createStylizedMaterial({ color: config.bodyColor, roughness: 0.9 }),
    );
    body.position.y = 0.25 + config.wallHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // A trim band under the eaves ties the palette together.
    const band = new Mesh(
      roundedBoxGeometry(config.width + 0.14, 0.22, config.depth + 0.14, 0.1),
      createStylizedMaterial({ color: config.trimColor, roughness: 0.85 }),
    );
    band.position.y = config.wallHeight + 0.12;
    band.castShadow = true;
    group.add(band);

    // --- Roof --------------------------------------------------------------
    const roofMaterial = createStylizedMaterial({ color: config.roofColor, roughness: 0.86, flatShading: true });
    const roofRise = config.roof === 'hip' ? config.depth * 0.34 : config.depth * 0.46;
    const roofGeometry = config.roof === 'hip'
      ? hipRoofGeometry(config.width, config.depth, roofRise, 0.65)
      : gableRoofGeometry(config.width, config.depth, roofRise, 0.55);
    const roof = new Mesh(roofGeometry, roofMaterial);
    roof.position.y = config.wallHeight + 0.3;
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    // Ridge cap, which reads as tiling from the game camera.
    if (config.roof === 'gable') {
      const ridge = new Mesh(
        new BoxGeometry(0.34, 0.22, config.depth + 1.2),
        createStylizedMaterial({ color: config.trimColor, roughness: 0.85 }),
      );
      ridge.position.y = config.wallHeight + 0.3 + roofRise - 0.05;
      ridge.castShadow = true;
      group.add(ridge);
    }

    // --- Chimney -----------------------------------------------------------
    if (config.id !== 'museum' && config.id !== 'townHall') {
      const chimney = new Mesh(
        roundedBoxGeometry(0.7, config.wallHeight * 0.55 + roofRise, 0.7, 0.1),
        createStylizedMaterial({ color: PALETTE.rock.base, roughness: 0.95, flatShading: true }),
      );
      chimney.position.set(
        config.width * 0.26,
        config.wallHeight * 0.4 + (config.wallHeight * 0.55 + roofRise) / 2,
        -config.depth * 0.18,
      );
      chimney.castShadow = true;
      group.add(chimney);
      const cap = new Mesh(
        roundedBoxGeometry(0.9, 0.16, 0.9, 0.06),
        createStylizedMaterial({ color: PALETTE.rock.dark, roughness: 0.9 }),
      );
      cap.position.set(
        chimney.position.x,
        chimney.position.y + (config.wallHeight * 0.55 + roofRise) / 2 + 0.08,
        chimney.position.z,
      );
      group.add(cap);
    }

    // --- Door --------------------------------------------------------------
    const door = makeDoor({
      color: config.doorColor,
      frameColor: config.trimColor,
      awning: config.awning,
      awningColor: config.roofColor,
      height: config.id === 'museum' || config.id === 'townHall' ? 2.7 : 2.15,
      width: config.id === 'museum' ? 1.8 : 1.15,
    });
    door.group.position.set(0, 0.25, config.depth / 2 + 0.06);
    group.add(door.group);

    // Steps up to the entrance.
    for (let i = 0; i < 2; i++) {
      const step = new Mesh(
        roundedBoxGeometry(2.4 - i * 0.3, 0.16, 0.5, 0.08),
        createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.95 }),
      );
      step.position.set(0, 0.06 + i * 0.15, config.depth / 2 + 0.75 - i * 0.42);
      step.receiveShadow = true;
      step.castShadow = true;
      group.add(step);
    }

    // --- Windows -----------------------------------------------------------
    const frontWindows = Math.min(2, config.windows);
    const spacing = config.width / (frontWindows + 1);
    for (let i = 0; i < frontWindows; i++) {
      const built = makeWindow({
        frameColor: config.trimColor,
        planter: config.id === 'playerHome' || config.id.startsWith('home.'),
      });
      const offset = -config.width / 2 + spacing * (i + 1);
      // Keep windows clear of the doorway.
      const x = Math.abs(offset) < 1.4 ? offset + Math.sign(offset || 1) * 1.9 : offset;
      built.group.position.set(x, config.wallHeight * 0.58, config.depth / 2 + 0.06);
      group.add(built.group);
      windows.push(built.glass);
    }
    for (let i = 0; i < config.windows - frontWindows; i++) {
      const built = makeWindow({ frameColor: config.trimColor });
      const side = i % 2 === 0 ? 1 : -1;
      built.group.position.set(side * (config.width / 2 + 0.06), config.wallHeight * 0.58, (i < 2 ? 1 : -1) * config.depth * 0.22);
      built.group.rotation.y = side * Math.PI / 2;
      group.add(built.group);
      windows.push(built.glass);
    }

    // --- Sign --------------------------------------------------------------
    if (config.sign) {
      const sign = makeSign({ text: config.sign, hanging: config.hangingSign, boardColor: config.trimColor });
      if (config.hangingSign) {
        sign.position.set(config.width / 2 + 0.4, config.wallHeight * 0.82, config.depth / 2 + 0.3);
        sign.rotation.y = -0.35;
      } else {
        sign.position.set(0, config.wallHeight + roofRise * 0.32, config.depth / 2 + 0.18);
      }
      group.add(sign);
    } else {
      const plate = makeSign({ text: config.name.replace(/'s House$/, ''), width: 1.5, height: 0.42, boardColor: config.trimColor });
      plate.position.set(1.5, config.wallHeight * 0.78, config.depth / 2 + 0.14);
      group.add(plate);
    }

    // --- Landscaping and lamps ---------------------------------------------
    group.add(makeLandscaping(config.width, config.depth, config.id.length));

    for (const lampSpot of config.lamps ?? []) {
      const lamp = makeStreetLamp({ height: config.id === 'museum' ? 4.2 : 3.4 });
      lamp.group.position.set(lampSpot.x, 0, lampSpot.z);
      group.add(lamp.group);
      lampLights.push(lamp.light);
      lampGlass.push(lamp.glass);
    }

    // Museum gets a colonnade so it reads as a civic building.
    if (config.id === 'museum') this.addColonnade(config, group);

    return {
      config,
      group,
      doorway: this.doorwayWorldPosition(config, config.depth / 2 + 2.6),
      doorFacing: config.rotation + Math.PI,
      doorLeaf: door.leaf,
      private_windows: windows,
      lampLights,
      lampGlass,
      collider: { x: config.x, z: config.z, halfW: config.width / 2, halfD: config.depth / 2, rotation: config.rotation },
    };
  }

  private addColonnade(config: BuildingConfig, group: Group): void {
    const stone = createStylizedMaterial({ color: '#efe8da', roughness: 0.92 });
    const count = 4;
    for (let i = 0; i < count; i++) {
      const x = -config.width / 2 + 1.6 + i * ((config.width - 3.2) / (count - 1));
      if (Math.abs(x) < 2) continue;
      const column = new Mesh(new CylinderGeometry(0.34, 0.4, config.wallHeight * 0.92, 12), stone);
      column.position.set(x, config.wallHeight * 0.46 + 0.25, config.depth / 2 + 1.5);
      column.castShadow = true;
      column.receiveShadow = true;
      group.add(column);
    }
    const portico = new Mesh(
      roundedBoxGeometry(config.width - 1.2, 0.5, 3.4, 0.12),
      createStylizedMaterial({ color: '#f6f0e2', roughness: 0.9 }),
    );
    portico.position.set(0, config.wallHeight * 0.95 + 0.25, config.depth / 2 + 1.5);
    portico.castShadow = true;
    group.add(portico);
  }

  private buildLighthouse(
    config: BuildingConfig,
    group: Group,
    windows: MeshStandardMaterial[],
  ): { doorLeaf: Group; beacon: BuildingInstance['beacon'] } {
    const white = createStylizedMaterial({ color: config.bodyColor, roughness: 0.88 });
    const red = createStylizedMaterial({ color: config.trimColor, roughness: 0.86 });

    const base = new Mesh(new CylinderGeometry(3.2, 3.9, 1.1, 16), createStylizedMaterial({ color: PALETTE.rock.base, roughness: 0.96, flatShading: true }));
    base.position.y = 0.5;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Alternating bands give the tower its silhouette at any distance.
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const h = config.wallHeight / bands;
      const rBottom = 2.5 - (i / bands) * 0.9;
      const rTop = 2.5 - ((i + 1) / bands) * 0.9;
      const band = new Mesh(new CylinderGeometry(rTop, rBottom, h, 16), i % 2 === 0 ? white : red);
      band.position.y = 1.05 + h * (i + 0.5);
      band.castShadow = true;
      band.receiveShadow = true;
      group.add(band);
    }

    const gallery = new Mesh(new CylinderGeometry(2.3, 2.3, 0.28, 16), createStylizedMaterial({ color: '#3f4a52', roughness: 0.6, metalness: 0.3 }));
    gallery.position.y = config.wallHeight + 1.2;
    gallery.castShadow = true;
    group.add(gallery);

    const lampGlassMaterial = new MeshStandardMaterial({
      color: 0xfff0c0,
      emissive: 0xffe08a,
      emissiveIntensity: 0,
      roughness: 0.15,
      transparent: true,
      opacity: 0.85,
    });
    const lampRoom = new Mesh(new CylinderGeometry(1.5, 1.5, 2.2, 14), lampGlassMaterial);
    lampRoom.position.y = config.wallHeight + 2.4;
    group.add(lampRoom);
    windows.push(lampGlassMaterial);

    const cap = new Mesh(new ConeGeometry(1.9, 1.5, 14), red);
    cap.position.y = config.wallHeight + 4.2;
    cap.castShadow = true;
    group.add(cap);

    const finial = new Mesh(new SphereGeometry(0.22, 10, 8), createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.35, metalness: 0.6 }));
    finial.position.y = config.wallHeight + 5.05;
    group.add(finial);

    // The rotating beam. Kept as a spotlight on a pivot so it sweeps the bay.
    const pivot = new Object3D();
    pivot.position.y = config.wallHeight + 2.4;
    group.add(pivot);
    const beam = new SpotLight(0xffe6b0, 0, 90, 0.24, 0.55, 1.4);
    beam.position.set(0, 0, 0);
    beam.target.position.set(0, -6, 60);
    pivot.add(beam);
    pivot.add(beam.target);

    const door = makeDoor({ color: config.doorColor, frameColor: '#e8e2d2', height: 2.1, width: 1.05 });
    door.group.position.set(0, 1.05, 2.42);
    group.add(door.group);

    return { doorLeaf: door.leaf, beacon: { light: beam, glass: lampGlassMaterial, pivot } };
  }

  private doorwayWorldPosition(config: BuildingConfig, distance: number): Vector3 {
    const dx = Math.sin(config.rotation) * distance;
    const dz = Math.cos(config.rotation) * distance;
    const x = config.x + dx;
    const z = config.z + dz;
    return new Vector3(x, terrainHeight(x, z), z);
  }

  /** Drives window glow, lamps and the lighthouse beam from time and weather. */
  update(dt: number, darkness: number, lighthouseRestored: boolean, hour: number): void {
    // Windows warm up in the evening and go dark late as villagers sleep.
    const evening = smoothstep(0.28, 0.65, darkness);
    const asleep = hour >= 23 || hour < 5.5 ? 0.22 : 1;
    const windowGlow = evening * asleep;
    const lampGlow = smoothstep(0.22, 0.55, darkness);

    for (const instance of this.instances.values()) {
      const isPublic = instance.config.id === 'museum' || instance.config.id === 'townHall' || instance.config.id === 'store';
      const glow = instance.config.id === 'lighthouse'
        ? (lighthouseRestored ? clamp01(darkness * 1.4) : 0)
        : windowGlow * (isPublic ? (hour >= 8 && hour < 22 ? 1 : 0.25) : 1);

      for (const glass of instance.private_windows) {
        glass.emissiveIntensity = glow * 1.35;
      }
      for (let i = 0; i < instance.lampLights.length; i++) {
        instance.lampLights[i].intensity = lampGlow * 5.5;
        instance.lampGlass[i].emissiveIntensity = lampGlow * 2.2;
      }

      if (instance.beacon) {
        const on = lighthouseRestored ? clamp01(darkness * 1.6) : 0;
        instance.beacon.light.intensity = on * 220;
        instance.beacon.glass.emissiveIntensity = on * 3.2;
        // A slow sweep, roughly one rotation every eight seconds.
        instance.beacon.pivot.rotation.y += dt * 0.78;
      }
    }
  }

  /** Opens or closes a building's door leaf, for entry transitions. */
  setDoorOpen(id: BuildingId, open: boolean, dt: number): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    const target = open ? -Math.PI * 0.62 : 0;
    instance.doorLeaf.rotation.y += (target - instance.doorLeaf.rotation.y) * Math.min(1, dt * 9);
  }

  /** Applies the player's chosen exterior style to their cottage. */
  applyHouseStyle(styleId: string): void {
    const style = HOUSE_STYLES_BY_ID.get(styleId);
    const instance = this.instances.get('playerHome');
    if (!style || !instance) return;

    instance.group.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as MeshStandardMaterial;
      if (!material || Array.isArray(mesh.material)) return;
      // Repaint by matching the colours the cottage was built with.
      const hex = `#${material.color.getHexString()}`;
      if (hex === instance.config.roofColor.toLowerCase()) material.color.set(style.roof);
      else if (hex === instance.config.bodyColor.toLowerCase()) material.color.set(style.body);
      else if (hex === instance.config.trimColor.toLowerCase()) material.color.set(style.trim);
      else if (hex === instance.config.doorColor.toLowerCase()) material.color.set(style.door);
    });

    instance.config.roofColor = style.roof;
    instance.config.bodyColor = style.body;
    instance.config.trimColor = style.trim;
    instance.config.doorColor = style.door;
  }

  /** Solid parts the player should collide with. */
  get colliders(): BuildingInstance['collider'][] {
    return [...this.instances.values()].map((i) => i.collider);
  }

  /** Meshes the camera fades when they block the player. */
  get occluders(): Object3D[] {
    return [...this.instances.values()].map((i) => i.group);
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
