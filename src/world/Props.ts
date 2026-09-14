import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { kitGeometry, kitMaterial, makeKitMesh } from '@/assets/registry';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { smoothstep } from '@/util/math';
import { makeSign, makeStreetLamp, roundedBoxGeometry, surfaces } from './BuildingKit';
import { flagstoneTexture } from '@/rendering/textures';
import { mergeGeometries } from '@/util/three';
import {
  BRIDGES,
  CREEK,
  ISLAND_HALF,
  LANDMARKS,
  PIER_DECK_HEIGHT,
  PIER_START,
  SEA_LEVEL,
  creekDepth,
  distanceToCreek,
  isWalkable,
  sampleSurface,
  terrainHeight,
} from './heightfield';
import { buildRegionLandmarks, type OrchardGate } from './Landmarks';
import { isInRegion } from './regions';

export interface GatherNode {
  id: string;
  kind: 'rock' | 'digSpot' | 'shell' | 'stick' | 'forage';
  x: number;
  z: number;
  y: number;
  /** In-game day the node was last harvested. Nodes regrow after a cooldown. */
  harvestedOnDay: number;
  /** Index into the corresponding instanced mesh. */
  index: number;
  /** Runtime hit animation. */
  hitTimer: number;
  /**
   * The randomised transform written at build time. Kept because harvesting
   * overwrites the instance matrix with a hidden one, and regrowing has to put
   * the original back — recomputing it would need the build RNG again. Dig
   * spots rebuild their two arms instead, so they do not carry one.
   */
  matrix?: Matrix4;
  /**
   * The instanced mesh this node lives in. Rocks come in three kit variants,
   * each its own mesh, so the kind alone no longer identifies the batch.
   */
  mesh?: InstancedMesh;
  /**
   * What picking this yields. Only forage carries one: a rock always gives
   * stone, but a forage node is ridge herb or grove mushroom or creek cress
   * depending entirely on which region it grew in.
   */
  defId?: string;
}

/**
 * Everything that dresses the island but is not terrain, water, foliage or a
 * building: the square, the harbour, the bridge, benches, fences, rocks and
 * the diggable spots. Gatherable nodes keep their state here and are drawn
 * instanced so respawning is a matrix write.
 */
export class Props {
  readonly group = new Group();
  readonly gatherNodes: GatherNode[] = [];

  private rockMesh: InstancedMesh | null = null;
  private digMesh: InstancedMesh | null = null;
  private shellMesh: InstancedMesh | null = null;
  private lampLights: PointLight[] = [];
  private lampGlass: MeshStandardMaterial[] = [];
  private dummy = new Object3D();
  private waterTrough: Mesh | null = null;
  private campfire: { light: PointLight; glow: MeshStandardMaterial; position: Vector3 } | null = null;
  /** The Secret Orchard's gate, and the collider that keeps it secret. */
  readonly orchardGate: OrchardGate;
  /** The moored rowboat, kept so `update` can ride it on the swell. */
  private rowboat: { group: Group; x: number; z: number; heading: number } | null = null;

  // Rowboat dimensions, in metres, measured from the waterline. The hull is
  // built around these so the freeboard is stated once rather than implied by
  // a stack of offsets.
  /** Half-beam where the topside meets the rounded bottom. */
  private static readonly BOAT_CHINE_RADIUS = 1.16;
  /** Half-beam at the gunwale — the topside flares out to here. */
  private static readonly BOAT_BEAM_RADIUS = 1.3;
  /** The hull is a body of revolution stretched this much along its length. */
  private static readonly BOAT_LENGTH_SCALE = 2.3;
  /** How far the chine sits below the surface. */
  private static readonly BOAT_CHINE_Y = -0.26;
  /** Chine to gunwale: the visible side of the hull. */
  private static readonly BOAT_FREEBOARD = 0.86;
  private static readonly BOAT_GUNWALE_Y = Props.BOAT_CHINE_Y + Props.BOAT_FREEBOARD;
  /**
   * The sole, above the surface. The ocean is one unbroken plane that passes
   * straight through the hull, so anything inside the boat below the waterline
   * is drawn under water and the boat reads as swamped. Decking over at this
   * height hides the flooded bilge and leaves the interior dry, with enough
   * margin for the fine ripple the CPU swell does not model.
   */
  private static readonly BOAT_SOLE_Y = 0.18;
  /** Signposts with their label, so the map and the world agree. */
  readonly signposts: { x: number; z: number; label: string }[] = [];

  /** Solid props the player collides with, as circles. */
  readonly colliders: { x: number; z: number; radius: number }[] = [];

  constructor() {
    this.group.name = 'Props';
    const rng = new Rng(31337);

    this.buildTownSquare();
    this.buildHarbour();
    this.buildBridge();
    this.buildMeadowStairs();
    this.buildFences();
    this.buildBeachDressing(rng);

    // The six outer regions. Their dressing lives in its own module — it is as
    // much geometry again as everything above — but its colliders, signposts
    // and lamps join the island's, so nothing downstream has to know.
    const regions = buildRegionLandmarks();
    this.group.add(regions.group);
    this.colliders.push(...regions.colliders);
    this.signposts.push(...regions.signposts);
    for (const lamp of regions.lamps) {
      this.lampLights.push(lamp.light);
      this.lampGlass.push(lamp.glass);
    }
    this.orchardGate = regions.gate;
    this.colliders.push(this.orchardGate.collider);

    this.buildRocks(rng);
    this.buildDigSpots(rng);
    this.buildShells(rng);
    this.buildForage(rng);
  }

  /**
   * Opens or shuts the orchard gate, dropping the collider that bars the way.
   *
   * Player movement reads `colliders` fresh every frame, so removing the entry
   * is all it takes for the gateway to become passable.
   */
  setOrchardOpen(open: boolean, instant = false): void {
    this.orchardGate.setOpen(open, instant);
    const index = this.colliders.indexOf(this.orchardGate.collider);
    if (open && index >= 0) this.colliders.splice(index, 1);
    else if (!open && index < 0) this.colliders.push(this.orchardGate.collider);
  }

  // --- Town square ---------------------------------------------------------

  private buildTownSquare(): void {
    const centre = LANDMARKS['square.center'];
    const groundY = terrainHeight(centre.x, centre.z);
    const square = new Group();
    square.name = 'TownSquare';
    square.position.set(centre.x, groundY, centre.z);
    this.group.add(square);

    const stone = createStylizedMaterial({ color: '#e2dbcd', roughness: 0.92 });
    const stoneDark = createStylizedMaterial({ color: '#c3b9a6', roughness: 0.94 });
    const paving = createStylizedMaterial({ color: '#e6dfd0', roughness: 0.94, map: flagstoneTexture(), mapRepeat: 6 });
    const water = new MeshStandardMaterial({
      color: 0x7fc9de,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
    });

    // Fountain: three tiers, a basin and a spout.
    const basin = new Mesh(new CylinderGeometry(3.1, 3.4, 0.7, 24), stone);
    basin.position.y = 0.35;
    basin.castShadow = true;
    basin.receiveShadow = true;
    square.add(basin);

    const rim = new Mesh(new TorusGeometry(3.12, 0.16, 8, 28), stoneDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.7;
    rim.castShadow = true;
    square.add(rim);

    const pool = new Mesh(new CylinderGeometry(2.94, 2.94, 0.1, 24), water);
    pool.position.y = 0.66;
    square.add(pool);
    this.waterTrough = pool;

    const column = new Mesh(new CylinderGeometry(0.42, 0.62, 1.5, 14), stone);
    column.position.y = 1.4;
    column.castShadow = true;
    square.add(column);

    const upperBowl = new Mesh(new CylinderGeometry(1.35, 0.55, 0.42, 18), stone);
    upperBowl.position.y = 2.25;
    upperBowl.castShadow = true;
    square.add(upperBowl);

    const spout = new Mesh(new SphereGeometry(0.28, 12, 10), stoneDark);
    spout.position.y = 2.62;
    square.add(spout);

    // A falling ribbon of water so the fountain reads as running.
    const fall = new Mesh(new CylinderGeometry(0.07, 0.13, 1.5, 8, 1, true), water);
    fall.position.y = 1.6;
    square.add(fall);
    const upperWater = new Mesh(new CylinderGeometry(1.24, 1.24, 0.06, 18), water);
    upperWater.position.y = 2.42;
    square.add(upperWater);
    this.colliders.push({ x: centre.x, z: centre.z, radius: 3.5 });

    // Paving ring around the fountain, laid as radial slabs.
    // Paving: a wide apron disc with joint lines cut into it, rather than
    // separate tiles, so the square reads as one worked surface.
    const apron = new Mesh(new CylinderGeometry(8.8, 9.1, 0.14, 48), paving);
    apron.position.y = 0.02;
    apron.receiveShadow = true;
    square.add(apron);

    const joint = roundedBoxGeometry(1.55, 0.05, 1.05, 0.07);
    const jointMesh = new InstancedMesh(joint, stoneDark, 66);
    jointMesh.receiveShadow = true;
    let slabIndex = 0;
    for (let ring = 0; ring < 2; ring++) {
      const radius = 4.4 + ring * 2.4;
      const count = 16 + ring * 6;
      for (let i = 0; i < count && slabIndex < 66; i++) {
        const a = (i / count) * Math.PI * 2 + ring * 0.18;
        this.dummy.position.set(Math.cos(a) * radius, 0.09, Math.sin(a) * radius);
        this.dummy.rotation.set(0, -a, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        jointMesh.setMatrixAt(slabIndex++, this.dummy.matrix);
      }
    }
    jointMesh.count = slabIndex;
    jointMesh.instanceMatrix.needsUpdate = true;
    square.add(jointMesh);

    // Notice board.
    const board = makeSign({ text: 'Cozy Cove', width: 2.4, height: 1.1, boardColor: '#f2e2c4' });
    board.position.set(-7.4, 2.0, 3.0);
    board.rotation.y = 0.5;
    square.add(board);
    const boardPosts = new Group();
    for (const dx of [-1.0, 1.0]) {
      const post = new Mesh(new CylinderGeometry(0.1, 0.12, 2.0, 8), createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.92 }));
      post.position.set(dx, 1.0, 0);
      post.castShadow = true;
      boardPosts.add(post);
    }
    boardPosts.position.copy(board.position).setY(0);
    boardPosts.rotation.y = board.rotation.y;
    square.add(boardPosts);
    this.colliders.push({ x: centre.x - 7.4, z: centre.z + 3.0, radius: 1.4 });

    // Benches around the square.
    const benchSpots = [
      { x: 6, z: 5.4, r: -0.8 },
      { x: -6.2, z: -5.6, r: 2.4 },
      { x: 7.2, z: -4.4, r: -2.1 },
    ];
    for (const spot of benchSpots) {
      const bench = this.makeBench();
      bench.position.set(spot.x, 0, spot.z);
      bench.rotation.y = spot.r;
      square.add(bench);
      this.colliders.push({ x: centre.x + spot.x, z: centre.z + spot.z, radius: 1.1 });
    }

    // Flower beds.
    const bedMaterial = createStylizedMaterial({ color: PALETTE.dirt.tilled, roughness: 0.97 });
    const bloomMaterials = PALETTE.flowers.map((c) => createStylizedMaterial({ color: c, roughness: 0.85, wind: 'foliage', windScale: 1.6 }));
    const bedSpots = [{ x: -6.8, z: 5.2 }, { x: 7.6, z: 1.6 }, { x: -2.6, z: -7.6 }];
    bedSpots.forEach((spot, bedIndex) => {
      const bed = new Mesh(roundedBoxGeometry(3.4, 0.28, 2.0, 0.4), bedMaterial);
      bed.position.set(spot.x, 0.12, spot.z);
      bed.receiveShadow = true;
      square.add(bed);
      const stemMaterial = createStylizedMaterial({ color: '#5f8b4a', roughness: 0.95, wind: 'foliage', windScale: 1.2 });
      for (let i = 0; i < 14; i++) {
        const bx = spot.x - 1.45 + (i % 7) * 0.48;
        const bz = spot.z - 0.42 + Math.floor(i / 7) * 0.62;
        const stem = new Mesh(new CylinderGeometry(0.022, 0.03, 0.4, 5), stemMaterial);
        stem.position.set(bx, 0.42, bz);
        square.add(stem);
        const bloom = new Mesh(new SphereGeometry(0.085, 7, 6), bloomMaterials[(i + bedIndex) % bloomMaterials.length]);
        bloom.position.set(bx, 0.64, bz);
        bloom.scale.y = 0.75;
        bloom.castShadow = true;
        square.add(bloom);
      }
    });

    // Square lamps.
    for (const spot of [{ x: -4.8, z: 7.4 }, { x: 5.2, z: 7.8 }, { x: -8.2, z: -2.6 }, { x: 8.4, z: -5.2 }]) {
      const lamp = makeStreetLamp({ height: 3.9 });
      lamp.group.position.set(spot.x, 0, spot.z);
      square.add(lamp.group);
      this.lampLights.push(lamp.light);
      this.lampGlass.push(lamp.glass);
    }
  }

  /** A slatted wooden bench on iron legs, the square's standard seat. */
  private makeBench(): Group {
    const bench = new Group();
    const wood = surfaces.plank(PALETTE.wood.plank, 1.2);
    const iron = createStylizedMaterial({ color: '#48524f', roughness: 0.55, metalness: 0.35 });

    const seat = new Mesh(roundedBoxGeometry(2.1, 0.14, 0.62, 0.07), wood);
    seat.position.y = 0.52;
    seat.castShadow = true;
    seat.receiveShadow = true;
    bench.add(seat);

    const back = new Mesh(roundedBoxGeometry(2.1, 0.5, 0.12, 0.06), wood);
    back.position.set(0, 0.92, -0.26);
    back.rotation.x = -0.14;
    back.castShadow = true;
    bench.add(back);

    for (const dx of [-0.85, 0.85]) {
      const leg = new Mesh(new BoxGeometry(0.1, 0.52, 0.5), iron);
      leg.position.set(dx, 0.26, 0);
      leg.castShadow = true;
      bench.add(leg);
    }
    return bench;
  }

  // --- Harbour -------------------------------------------------------------

  private buildHarbour(): void {
    const pier = LANDMARKS['beach.pier'];
    const group = new Group();
    group.name = 'Harbour';
    this.group.add(group);

    const plank = surfaces.plank('#c9a06f', 0.75);
    const post = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.95 });

    // Decking starts on the sand and marches out over the water. Its extent
    // and height come from the heightfield's platform so the player walks on
    // exactly what is drawn.
    const deckY = PIER_DECK_HEIGHT;
    const bays = 9;
    for (let i = 0; i < bays; i++) {
      const z = pier.z + PIER_START + 1.5 + i * 3.0;
      const deck = new Mesh(roundedBoxGeometry(5.2, 0.24, 3.0, 0.06), plank);
      deck.position.set(pier.x, deckY, z);
      deck.castShadow = true;
      deck.receiveShadow = true;
      group.add(deck);

      for (const dx of [-2.1, 2.1]) {
        const piling = new Mesh(new CylinderGeometry(0.22, 0.26, 7.5, 8), post);
        piling.position.set(pier.x + dx, deckY - 3.9, z);
        piling.castShadow = true;
        group.add(piling);

        if (i % 2 === 0) {
          const rail = new Mesh(new BoxGeometry(0.12, 0.9, 0.12), post);
          rail.position.set(pier.x + dx, deckY + 0.55, z);
          rail.castShadow = true;
          group.add(rail);
        }
      }
      if (i > 0) {
        for (const dx of [-2.1, 2.1]) {
          const beam = new Mesh(new BoxGeometry(0.1, 0.1, 3.0), post);
          beam.position.set(pier.x + dx, deckY + 0.95, z - 1.5);
          group.add(beam);
        }
      }
    }

    // A step up onto the deck at the landward end, so the half-metre rise
    // reads as a threshold rather than a floating slab.
    for (let i = 0; i < 2; i++) {
      const stepZ = pier.z + PIER_START - 0.35 - i * 0.55;
      const stepY = terrainHeight(pier.x, stepZ) + (deckY - terrainHeight(pier.x, stepZ)) * (i === 0 ? 0.62 : 0.3);
      const step = new Mesh(roundedBoxGeometry(4.4, 0.18, 0.6, 0.05), plank);
      step.position.set(pier.x, stepY, stepZ);
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }

    // Mooring bollards and a rowboat.
    for (const offset of [-3.5, 3.5]) {
      const bollard = new Mesh(new CylinderGeometry(0.24, 0.3, 0.9, 10), post);
      bollard.position.set(pier.x + offset, deckY + 0.45, pier.z + 4);
      bollard.castShadow = true;
      group.add(bollard);
    }
    group.add(this.makeRowboat(pier.x + 4.8, pier.z + 13, 0.4));

    // Crates, barrels and a chest on the apron — a working harbour, not a
    // stage set. Kit models where the survival kit is loaded, boxes otherwise.
    const crateMaterial = createStylizedMaterial({ color: '#c49a6c', roughness: 0.92 });
    const apron: { x: number; z: number; r: number; kind: 'crate' | 'barrel' | 'chest' | 'bucket'; s: number }[] = [
      { x: pier.x - 4, z: pier.z - 7, r: 0.3, kind: 'crate', s: 1.25 },
      { x: pier.x - 3.1, z: pier.z - 6.2, r: -0.6, kind: 'crate', s: 1.05 },
      { x: pier.x - 3.5, z: pier.z - 7.2, r: 0.1, kind: 'barrel', s: 1.2 },
      { x: pier.x + 6, z: pier.z - 4, r: 0.9, kind: 'barrel', s: 1.3 },
      { x: pier.x + 6.9, z: pier.z - 3.2, r: 0.2, kind: 'chest', s: 1.1 },
      { x: pier.x - 1.6, z: pier.z - 4.4, r: 1.4, kind: 'bucket', s: 1.1 },
    ];
    for (const spot of apron) {
      const y = terrainHeight(spot.x, spot.z);
      const kit = makeKitMesh(`props.${spot.kind}`, { scale: spot.s, roughness: 0.88 });
      if (kit) {
        kit.position.set(spot.x, y - 0.03, spot.z);
        kit.rotation.y = spot.r;
        group.add(kit);
      } else {
        const crate = new Mesh(roundedBoxGeometry(1.0, 1.0, 1.0, 0.08), crateMaterial);
        crate.position.set(spot.x, y + 0.5, spot.z);
        crate.rotation.y = spot.r;
        crate.castShadow = true;
        crate.receiveShadow = true;
        group.add(crate);
      }
      if (spot.kind !== 'bucket') this.colliders.push({ x: spot.x, z: spot.z, radius: 0.55 * spot.s });
    }

    // Lobster pots stacked at the pier head: rope-bound crates read as pots.
    for (let i = 0; i < 2; i++) {
      const pot = makeKitMesh('props.crate', { scale: 0.85, tint: '#d9c6a4' });
      if (!pot) break;
      pot.position.set(pier.x + 2.0, deckY + 0.12 + i * 0.6, pier.z + 7.5 - i * 0.05);
      pot.rotation.y = 0.3 + i * 0.5;
      group.add(pot);
    }

    // Lamp at the pier head.
    const lamp = makeStreetLamp({ height: 3.2 });
    lamp.group.position.set(pier.x - 2.4, deckY + 0.12, pier.z + 4);
    group.add(lamp.group);
    this.lampLights.push(lamp.light);
    this.lampGlass.push(lamp.glass);
  }

  /**
   * The rowboat moored off the pier head.
   *
   * Local Y is the waterline: the group rides the swell in `update`, so every
   * offset below is freeboard or draught and stays true whatever the weather
   * is doing. The hull is a rounded forefoot capped with a flared topside
   * band, rather than a bare hemisphere — the band is what gives the boat a
   * visible side above the water instead of a blue ring floating on the sea.
   */
  private makeRowboat(x: number, z: number, rotation: number): Group {
    const boat = new Group();
    boat.position.set(x, SEA_LEVEL, z);
    // Heading first, then pitch and roll about the boat's own axes.
    boat.rotation.order = 'YXZ';
    boat.rotation.y = rotation;

    const hullMaterial = createStylizedMaterial({ color: '#d8e0e4', roughness: 0.8 });
    const trimMaterial = createStylizedMaterial({ color: '#4a7fa8', roughness: 0.8 });
    const plankMaterial = createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.9 });

    // Open at the top, so both faces are seen: the far topside from inside.
    hullMaterial.side = DoubleSide;

    // Rounded bottom, from the chine down. Half of it sits under the surface.
    const bottom = new Mesh(
      new SphereGeometry(Props.BOAT_CHINE_RADIUS, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      hullMaterial,
    );
    bottom.position.y = Props.BOAT_CHINE_Y;
    bottom.scale.set(1.0, 0.62, Props.BOAT_LENGTH_SCALE);
    bottom.castShadow = true;
    bottom.receiveShadow = true;
    boat.add(bottom);

    // Topside: chine to gunwale, flaring outwards the way a dinghy's does.
    const topside = new Mesh(
      new CylinderGeometry(Props.BOAT_BEAM_RADIUS, Props.BOAT_CHINE_RADIUS, Props.BOAT_FREEBOARD, 16, 1, true),
      hullMaterial,
    );
    topside.position.y = Props.BOAT_CHINE_Y + Props.BOAT_FREEBOARD / 2;
    topside.scale.set(1.0, 1.0, Props.BOAT_LENGTH_SCALE);
    topside.castShadow = true;
    topside.receiveShadow = true;
    boat.add(topside);

    // The sole. Cut from the same 16-gon as the topside and a shade narrower,
    // so its edge tucks behind the planking instead of poking through it.
    const sole = new Mesh(new CylinderGeometry(Props.boatHalfBeamAt(Props.BOAT_SOLE_Y) - 0.02, Props.boatHalfBeamAt(Props.BOAT_SOLE_Y) - 0.02, 0.06, 16), plankMaterial);
    sole.position.y = Props.BOAT_SOLE_Y;
    sole.scale.set(1.0, 1.0, Props.BOAT_LENGTH_SCALE);
    sole.receiveShadow = true;
    boat.add(sole);

    const rim = new Mesh(new TorusGeometry(Props.BOAT_BEAM_RADIUS, 0.09, 6, 20), trimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.0, Props.BOAT_LENGTH_SCALE, 1);
    rim.position.y = Props.BOAT_GUNWALE_Y;
    boat.add(rim);

    // Thwarts, set a little below the gunwale and wide enough to reach it.
    const thwartY = Props.BOAT_GUNWALE_Y - 0.16;
    // The flats of the 16-gon sit inside its vertices, so span the inradius.
    const thwartWidth = Props.boatHalfBeamAt(thwartY) * 2 * Math.cos(Math.PI / 16);
    for (const dz of [-0.7, 0.5]) {
      const seat = new Mesh(new BoxGeometry(thwartWidth, 0.1, 0.34), plankMaterial);
      seat.position.set(0, thwartY, dz);
      seat.castShadow = true;
      boat.add(seat);
    }

    this.rowboat = { group: boat, x, z, heading: rotation };
    return boat;
  }

  /** Half-beam of the rowboat's flaring topside at a height above the water. */
  private static boatHalfBeamAt(y: number): number {
    const t = (y - Props.BOAT_CHINE_Y) / Props.BOAT_FREEBOARD;
    return Props.BOAT_CHINE_RADIUS + (Props.BOAT_BEAM_RADIUS - Props.BOAT_CHINE_RADIUS) * t;
  }

  // --- Bridge and stairs ---------------------------------------------------

  /** The cambered plank bridge over the creek, with rails. */
  private buildBridge(): void {
    const plank = surfaces.plank(PALETTE.wood.plank, 1.4);
    const beam = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.94 });

    for (const bridge of BRIDGES) {
      const group = new Group();
      group.name = 'Bridge';
      const y = Math.max(terrainHeight(bridge.x - 4, bridge.z), terrainHeight(bridge.x + 4, bridge.z)) + 0.6;
      group.position.set(bridge.x, y, bridge.z);
      group.rotation.y = bridge.rotation;
      this.group.add(group);

      const planks = 12;
      for (let i = 0; i < planks; i++) {
        const t = i / (planks - 1);
        const board = new Mesh(roundedBoxGeometry(bridge.width, 0.16, bridge.length / planks * 0.92, 0.04), plank);
        // A gentle camber so the bridge arcs over the creek.
        board.position.set(0, Math.sin(t * Math.PI) * 0.34, -bridge.length / 2 + t * bridge.length);
        board.castShadow = true;
        board.receiveShadow = true;
        group.add(board);
      }

      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const t = i / 3;
          const post = new Mesh(new CylinderGeometry(0.09, 0.11, 1.1, 8), beam);
          post.position.set(side * (bridge.width / 2 - 0.2), 0.55 + Math.sin(t * Math.PI) * 0.34, -bridge.length / 2 + t * bridge.length);
          post.castShadow = true;
          group.add(post);
        }
        const rail = new Mesh(new BoxGeometry(0.1, 0.1, bridge.length), beam);
        rail.position.set(side * (bridge.width / 2 - 0.2), 1.18, 0);
        rail.castShadow = true;
        group.add(rail);
      }
    }
  }

  private buildMeadowStairs(): void {
    // Steps up the ridge toward the high meadow.
    const stone = createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.95, flatShading: true });
    const group = new Group();
    group.name = 'MeadowStairs';
    this.group.add(group);

    const start = { x: -30, z: -24 };
    const end = { x: -39, z: -34 };
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      const y = terrainHeight(x, z);
      const step = new Mesh(roundedBoxGeometry(3.4, 0.34, 1.3, 0.08), stone);
      step.position.set(x, y + 0.16, z);
      step.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
      step.castShadow = true;
      step.receiveShadow = true;
      group.add(step);
    }
  }

  private buildFences(): void {
    const wood = createStylizedMaterial({ color: PALETTE.wood.plankDark, roughness: 0.94 });
    const group = new Group();
    group.name = 'Fences';
    this.group.add(group);

    // A picket run around the farm terrace. The creek runs straight through the
    // middle of it, so the run breaks at both banks rather than marching a
    // fence post into the water.
    const centre = LANDMARKS['farm.terrace'];
    const radius = 11;
    const fenceGeometry = kitGeometry('yard.fence');
    // The town kit's fence is one grid cell long; at 2.6x it is a 2.6 m run
    // that stands a little over a metre, which is picket height.
    const segment = fenceGeometry ? 2.6 : 2.3;
    const count = Math.round((Math.PI * 2 * radius) / segment);
    const fenceMaterial = kitMaterial({ roughness: 0.92, tint: '#f0e4d0' });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // Leave a gap where the path arrives.
      if (a > 4.4 && a < 5.2) continue;
      const x = centre.x + Math.cos(a) * radius;
      const z = centre.z + Math.sin(a) * radius;
      // ...and wherever the creek crosses the line.
      if (creekDepth(x, z) > 0.02 || distanceToCreek(x, z) < CREEK.width * 1.3) continue;
      const y = terrainHeight(x, z);

      if (fenceGeometry) {
        const run = new Mesh(fenceGeometry, fenceMaterial);
        // The kit fence lies along its local Z; rotate it onto the tangent.
        run.position.set(x, y - 0.02, z);
        run.rotation.y = -a;
        run.scale.setScalar(segment);
        run.castShadow = true;
        run.receiveShadow = true;
        group.add(run);
        continue;
      }

      const post = new Mesh(roundedBoxGeometry(0.16, 1.15, 0.16, 0.04), wood);
      post.position.set(x, y + 0.55, z);
      post.rotation.y = -a;
      post.castShadow = true;
      group.add(post);

      const rail = new Mesh(new BoxGeometry(0.08, 0.1, 2.4), wood);
      rail.position.set(x, y + 0.78, z);
      rail.rotation.y = -a;
      group.add(rail);
    }

    // Signposts at the junctions where a newcomer would hesitate.
    const posts: { x: number; z: number; r: number; label: string }[] = [
      { x: 3.4, z: 16.5, r: 0.4, label: 'Beach' },
      { x: -8.6, z: -13.2, r: -0.9, label: 'Museum' },
      { x: 13.8, z: 6.2, r: 0.9, label: 'East Shore' },
      { x: -26.4, z: 8.4, r: -0.5, label: 'Garden' },
      { x: -30.0, z: -23.0, r: -2.2, label: 'High Meadow' },
      { x: -47.0, z: -5.5, r: -1.4, label: 'West Grove' },
      { x: 42.4, z: 2.0, r: 0.3, label: 'East Ridge' },
    ];
    for (const spot of posts) {
      const y = terrainHeight(spot.x, spot.z);
      const kit = makeKitMesh('props.signpost', { scale: 1.55, roughness: 0.9 });
      if (kit) {
        kit.position.set(spot.x, y, spot.z);
        kit.rotation.y = spot.r;
        group.add(kit);
      } else {
        const sign = makeSign({ text: spot.label, width: 1.3, height: 0.42, boardColor: '#e8d6b2' });
        sign.position.set(spot.x, y + 1.6, spot.z);
        sign.rotation.y = spot.r;
        group.add(sign);
        const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 1.7, 8), wood);
        pole.position.set(spot.x, y + 0.85, spot.z);
        group.add(pole);
      }
      this.signposts.push({ x: spot.x, z: spot.z, label: spot.label });
      this.colliders.push({ x: spot.x, z: spot.z, radius: 0.35 });
    }
  }

  private buildBeachDressing(rng: Rng): void {
    const group = new Group();
    group.name = 'BeachDressing';
    this.group.add(group);

    // The driftwood log villagers sit on.
    const log = LANDMARKS['beach.log'];
    // Kit shape, our own colour: the survival kit's log is fresh red timber,
    // and driftwood has been bleached grey by a year of salt and sun.
    const logGeometry = kitGeometry('props.log');
    const kitLog = logGeometry
      ? new Mesh(logGeometry, createStylizedMaterial({ color: '#cfc2a8', roughness: 0.96, flatShading: true }))
      : null;
    if (kitLog) {
      kitLog.scale.setScalar(1.5);
      kitLog.castShadow = true;
      kitLog.receiveShadow = true;
      kitLog.position.set(log.x, terrainHeight(log.x, log.z) - 0.05, log.z);
      kitLog.rotation.y = 0.5 + Math.PI / 2;
      group.add(kitLog);
    } else {
      const logMesh = new Mesh(
        new CylinderGeometry(0.55, 0.65, 4.6, 10),
        createStylizedMaterial({ color: '#c4b49a', roughness: 0.96, flatShading: true }),
      );
      logMesh.position.set(log.x, terrainHeight(log.x, log.z) + 0.5, log.z);
      logMesh.rotation.set(0, 0.5, Math.PI / 2);
      logMesh.castShadow = true;
      logMesh.receiveShadow = true;
      group.add(logMesh);
    }
    this.colliders.push({ x: log.x, z: log.z, radius: 1.6 });

    // A fire pit beside the log, lit after dark — the beach's evening anchor.
    const fireX = log.x + 2.6;
    const fireZ = log.z + 1.4;
    const firePit = makeKitMesh('props.campfire', { scale: 1.5, roughness: 0.96 });
    if (firePit) {
      firePit.position.set(fireX, terrainHeight(fireX, fireZ), fireZ);
      group.add(firePit);
    } else {
      const ring = new Mesh(new TorusGeometry(0.7, 0.16, 6, 14), createStylizedMaterial({ color: PALETTE.rock.dark, roughness: 0.96, flatShading: true }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(fireX, terrainHeight(fireX, fireZ) + 0.12, fireZ);
      ring.castShadow = true;
      group.add(ring);
    }
    const fireGlow = new MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a22, emissiveIntensity: 0, roughness: 0.6 });
    const embers = new Mesh(new SphereGeometry(0.34, 10, 8), fireGlow);
    embers.scale.set(1.3, 0.55, 1.3);
    embers.position.set(fireX, terrainHeight(fireX, fireZ) + 0.22, fireZ);
    group.add(embers);
    const fireLight = new PointLight(0xff9a4a, 0, 11, 2);
    fireLight.position.set(fireX, terrainHeight(fireX, fireZ) + 0.9, fireZ);
    group.add(fireLight);
    this.campfire = { light: fireLight, glow: fireGlow, position: new Vector3(fireX, terrainHeight(fireX, fireZ) + 0.3, fireZ) };
    this.colliders.push({ x: fireX, z: fireZ, radius: 1.0 });

    // Beach umbrellas and towels near the dunes.
    const dunes = LANDMARKS['beach.dunes'];
    for (let i = 0; i < 2; i++) {
      const x = dunes.x + i * 6 + rng.spread(2);
      const z = dunes.z + rng.spread(3);
      const y = terrainHeight(x, z);
      const pole = new Mesh(new CylinderGeometry(0.06, 0.06, 2.4, 8), createStylizedMaterial({ color: '#e8dcc0', roughness: 0.8 }));
      pole.position.set(x, y + 1.2, z);
      pole.castShadow = true;
      group.add(pole);

      // A proper parasol: a shallow cone reads far better than a sphere cap.
      const canopy = new Mesh(
        new ConeGeometry(1.5, 0.62, 10),
        createStylizedMaterial({ color: i ? '#f2946b' : '#7fc9de', roughness: 0.86 }),
      );
      canopy.position.set(x, y + 2.32, z);
      canopy.rotation.z = 0.06;
      canopy.castShadow = true;
      group.add(canopy);

      const finial = new Mesh(
        new SphereGeometry(0.09, 8, 6),
        createStylizedMaterial({ color: '#e8dcc0', roughness: 0.8 }),
      );
      finial.position.set(x, y + 2.68, z);
      group.add(finial);
    }
  }

  // --- Gatherable nodes ----------------------------------------------------

  private buildRocks(rng: Rng): void {
    const placements: { x: number; y: number; z: number; s: number; r: number }[] = [];
    const usable = (x: number, z: number) => {
      const sample = sampleSurface(x, z);
      if (sample.height < 1.6 || sample.slope > 0.55) return null;
      if (sample.surface === 'path' || sample.surface === 'plaza') return null;
      return sample;
    };

    let attempts = 0;
    while (placements.length < 26 && attempts < 900) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 12);
      const z = rng.spread(ISLAND_HALF - 12);
      const sample = usable(x, z);
      if (!sample) continue;
      if (Math.hypot(x, z) < 20) continue;
      placements.push({ x, y: sample.height, z, s: rng.range(0.8, 1.6), r: rng.range(0, 6.28) });
    }

    // A boulder field on Lighthouse Point. Cove Stone's own description says it
    // is chipped from the headland, and until now it came from everywhere but:
    // this is what makes the walk out to the point worth making with an axe.
    const point = LANDMARKS['lighthouse.point'];
    attempts = 0;
    let onPoint = 0;
    while (onPoint < 9 && attempts < 500) {
      attempts++;
      const angle = rng.range(0, Math.PI * 2);
      const radius = 5 + Math.sqrt(rng.range(0, 1)) * 11;
      const x = point.x + Math.cos(angle) * radius;
      const z = point.z + Math.sin(angle) * radius;
      const sample = usable(x, z);
      if (!sample) continue;
      if (placements.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) continue;
      placements.push({ x, y: sample.height, z, s: rng.range(1.0, 1.8), r: rng.range(0, 6.28) });
      onPoint++;
    }

    // Three kit boulders, each its own instanced batch, so a field of rocks
    // is not one silhouette repeated. Falls back to the faceted blob.
    const variants = ['props.rock.a', 'props.rock.b', 'props.rock.c']
      .map((id) => kitGeometry(id))
      .filter((g): g is NonNullable<typeof g> => !!g);
    const useKit = variants.length > 0;
    const geometries = useKit ? variants : [new IcosahedronGeometry(1, 0)];
    const material = useKit
      ? kitMaterial({ roughness: 0.96, tint: '#e6e2da' })
      : createStylizedMaterial({ color: PALETTE.rock.base, roughness: 0.96, flatShading: true });

    const meshes = geometries.map((geometry, v) => {
      const mesh = new InstancedMesh(geometry, material, placements.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Rocks_${v}`;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });

    placements.forEach((p, i) => {
      const variant = i % meshes.length;
      const mesh = meshes[variant];
      const slot = mesh.count++;
      if (useKit) {
        // Kit rocks stand on their base at roughly two metres across, so a
        // smaller scale range than the unit blob gives the same footprint.
        const s = p.s * 0.7;
        this.dummy.position.set(p.x, p.y - 0.08, p.z);
        this.dummy.rotation.set(rng.range(-0.08, 0.08), p.r, rng.range(-0.08, 0.08));
        this.dummy.scale.set(s, s * rng.range(0.8, 1.05), s);
      } else {
        this.dummy.position.set(p.x, p.y + 0.5 * p.s, p.z);
        this.dummy.rotation.set(rng.range(-0.3, 0.3), p.r, rng.range(-0.3, 0.3));
        this.dummy.scale.set(p.s * 1.2, p.s * 0.85, p.s);
      }
      this.dummy.updateMatrix();
      mesh.setMatrixAt(slot, this.dummy.matrix);
      this.gatherNodes.push({
        matrix: this.dummy.matrix.clone(),
        mesh,
        id: `rock_${i}`, kind: 'rock', x: p.x, y: p.y, z: p.z,
        harvestedOnDay: -99, index: slot, hitTimer: 0,
      });
      this.colliders.push({ x: p.x, z: p.z, radius: p.s * 0.85 });
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    this.rockMesh = meshes[0];
  }

  private buildDigSpots(rng: Rng): void {
    // A small cross of turned earth marks a diggable spot.
    const geometry = roundedBoxGeometry(0.5, 0.06, 0.12, 0.03);
    const material = createStylizedMaterial({ color: PALETTE.dirt.tilled, roughness: 0.98 });
    const count = 14;
    const mesh = new InstancedMesh(geometry, material, count * 2);
    mesh.receiveShadow = true;
    mesh.name = 'DigSpots';

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 700) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 16);
      const z = rng.spread(ISLAND_HALF - 16);
      const sample = sampleSurface(x, z);
      if (sample.height < 1.2 || sample.slope > 0.35) continue;
      if (sample.surface === 'plaza' || sample.surface === 'water') continue;

      for (let arm = 0; arm < 2; arm++) {
        this.dummy.position.set(x, sample.height + 0.05, z);
        this.dummy.rotation.set(0, arm === 0 ? 0.7 : -0.7, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(placed * 2 + arm, this.dummy.matrix);
      }
      this.gatherNodes.push({
        id: `dig_${placed}`, kind: 'digSpot', x, y: sample.height, z,
        harvestedOnDay: -99, index: placed, hitTimer: 0,
      });
      placed++;
    }
    mesh.count = placed * 2;
    mesh.instanceMatrix.needsUpdate = true;
    this.digMesh = mesh;
    this.group.add(mesh);
  }

  private buildShells(rng: Rng): void {
    const geometry = new SphereGeometry(0.1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.scale(1, 0.6, 1.25);
    const material = createStylizedMaterial({ color: '#e8cfa8', roughness: 0.55 });
    const count = 18;
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.name = 'BeachShells';

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 900) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 24);
      const z = rng.range(20, ISLAND_HALF - 18);
      const sample = sampleSurface(x, z);
      if (sample.surface !== 'sand' || sample.height < 0.15 || sample.height > 1.3) continue;
      // Only genuinely coastal sand: there must be water within a few metres.
      const nearWater = [[6, 0], [-6, 0], [0, 6], [0, -6]].some(
        ([dx, dz]) => sampleSurface(x + dx, z + dz).height < SEA_LEVEL,
      );
      if (!nearWater) continue;
      this.dummy.position.set(x, sample.height + 0.03, z);
      this.dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2));
      this.dummy.scale.setScalar(rng.range(0.8, 1.3));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      this.gatherNodes.push({
        matrix: this.dummy.matrix.clone(),
        id: `shell_${placed}`, kind: 'shell', x, y: sample.height, z,
        harvestedOnDay: -99, index: placed, hitTimer: 0,
      });
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.shellMesh = mesh;
    this.group.add(mesh);
  }

  /**
   * Forage: the thing worth stooping for in each outer region.
   *
   * One instanced batch per kind, each placed by the rule that makes it belong
   * where it grows — herb in the meadow's thin soil, mushrooms in the grove's
   * shade, cress on the creek bank where the water actually moves. Every node
   * carries the item it yields, so harvesting does not have to guess from the
   * player's position what they just picked.
   */
  private buildForage(rng: Rng): void {
    interface ForagePlan {
      defId: string;
      name: string;
      count: number;
      color: string;
      geometry: () => BufferGeometry;
      /** Where this kind is allowed to grow. */
      suits: (x: number, z: number, sample: ReturnType<typeof sampleSurface>) => boolean;
      /** Sampling window, so a plan does not throw darts at the whole island. */
      area: { x: number; z: number; radius: number };
    }

    const plans: ForagePlan[] = [
      {
        defId: 'forage.ridgeHerb',
        name: 'RidgeHerb',
        count: 12,
        color: '#8fae72',
        geometry: herbTuftGeometry,
        suits: (x, z, sample) => isInRegion('meadow', x, z) && sample.surface === 'grass' && sample.slope < 0.4,
        area: { x: -42, z: -40, radius: 18 },
      },
      {
        defId: 'forage.groveMushroom',
        name: 'GroveMushroom',
        count: 12,
        color: '#c96f55',
        geometry: mushroomClumpGeometry,
        suits: (x, z, sample) => isInRegion('grove', x, z) && sample.surface === 'grass' && sample.slope < 0.45,
        area: { x: -56, z: 4, radius: 14 },
      },
      {
        defId: 'forage.creekCress',
        name: 'CreekCress',
        count: 14,
        color: '#5f9e6a',
        geometry: cressTuftGeometry,
        // On the bank, not in the channel: close enough to the water to be
        // cress, far enough out to be standing on something.
        suits: (x, z) => {
          const distance = distanceToCreek(x, z);
          return distance > 2.6 && distance < 6.2 && creekDepth(x, z) < 0.05 && isWalkable(x, z);
        },
        area: { x: -35, z: 4, radius: 42 },
      },
    ];

    for (const plan of plans) {
      const material = createStylizedMaterial({ color: plan.color, roughness: 0.92, flatShading: true });
      const mesh = new InstancedMesh(plan.geometry(), material, plan.count);
      mesh.name = `Forage_${plan.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      let placed = 0;
      let attempts = 0;
      while (placed < plan.count && attempts < plan.count * 120) {
        attempts++;
        const angle = rng.range(0, Math.PI * 2);
        const radius = Math.sqrt(rng.range(0, 1)) * plan.area.radius;
        const x = plan.area.x + Math.cos(angle) * radius;
        const z = plan.area.z + Math.sin(angle) * radius;
        const sample = sampleSurface(x, z);
        if (sample.surface === 'path' || sample.surface === 'plaza' || sample.surface === 'water') continue;
        if (!plan.suits(x, z, sample)) continue;
        // Never right on top of another clump, or a "region" is one dense patch.
        if (this.gatherNodes.some((n) => n.kind === 'forage' && Math.hypot(n.x - x, n.z - z) < 3.2)) continue;

        this.dummy.position.set(x, sample.height, z);
        this.dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
        this.dummy.scale.setScalar(rng.range(0.85, 1.25));
        this.dummy.updateMatrix();
        mesh.setMatrixAt(placed, this.dummy.matrix);
        this.gatherNodes.push({
          matrix: this.dummy.matrix.clone(),
          mesh,
          defId: plan.defId,
          id: `forage_${plan.name}_${placed}`,
          kind: 'forage',
          x, y: sample.height, z,
          harvestedOnDay: -99,
          index: placed,
          hitTimer: 0,
        });
        placed++;
      }

      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  /** Hides a harvested node and shows it again once it has regrown. */
  refreshNodes(day: number): void {
    const hidden = new Vector3(0, -1000, 0);

    for (const node of this.gatherNodes) {
      const available = day - node.harvestedOnDay >= NODE_COOLDOWNS[node.kind];
      const mesh = node.mesh ?? (node.kind === 'rock' ? this.rockMesh : node.kind === 'digSpot' ? this.digMesh : this.shellMesh);
      if (!mesh) continue;

      if (node.kind === 'digSpot') {
        for (let arm = 0; arm < 2; arm++) {
          if (available) {
            this.dummy.position.set(node.x, node.y + 0.05, node.z);
            this.dummy.rotation.set(0, arm === 0 ? 0.7 : -0.7, 0);
            this.dummy.scale.setScalar(1);
          } else {
            this.dummy.position.copy(hidden);
            this.dummy.scale.setScalar(0.001);
          }
          this.dummy.updateMatrix();
          mesh.setMatrixAt(node.index * 2 + arm, this.dummy.matrix);
        }
      } else if (!available) {
        this.dummy.position.copy(hidden);
        this.dummy.scale.setScalar(0.001);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(node.index, this.dummy.matrix);
      } else if (node.matrix) {
        // Without this branch a harvested rock or shell stays hidden for the
        // rest of the session: nothing ever wrote its transform back.
        mesh.setMatrixAt(node.index, node.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Nearest available node of any kind within radius. */
  nodeNear(x: number, z: number, radius: number, day: number, kinds?: GatherNode['kind'][]): GatherNode | null {
    let best: GatherNode | null = null;
    let bestDist = radius * radius;
    for (const node of this.gatherNodes) {
      if (kinds && !kinds.includes(node.kind)) continue;
      // Same cooldown table `refreshNodes` hides them by, or the prompt would
      // offer a node whose mesh is parked under the map.
      if (day - node.harvestedOnDay < NODE_COOLDOWNS[node.kind]) continue;
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  update(dt: number, darkness: number, time: number, waterHeight: (x: number, z: number) => number): void {
    const glow = smoothstep(0.22, 0.55, darkness);
    for (let i = 0; i < this.lampLights.length; i++) {
      // A touch of flicker keeps the lamps from looking like flat emissives.
      const flicker = 1 + Math.sin(time * 7.3 + i * 2.1) * 0.03;
      this.lampLights[i].intensity = glow * 6.0 * flicker;
      this.lampGlass[i].emissiveIntensity = glow * 1.5 * flicker;
    }
    if (this.waterTrough) {
      this.waterTrough.position.y = 0.62 + Math.sin(time * 1.4) * 0.012;
    }
    this.orchardGate.update(dt);
    if (this.campfire) {
      const lit = smoothstep(0.3, 0.7, darkness);
      const flicker = 1 + Math.sin(time * 11.3) * 0.12 + Math.sin(time * 4.1) * 0.08;
      this.campfire.light.intensity = lit * 9 * flicker;
      this.campfire.glow.emissiveIntensity = lit * 2.6 * flicker;
    }
    this.floatRowboat(waterHeight);
  }

  /**
   * Rides the moored rowboat on the swell.
   *
   * Sampling the surface at four points around the hull rather than one keeps
   * the freeboard constant in any weather and lets the boat heel into the
   * trough, which is what sells it as floating rather than pinned. The
   * gradients are gentle — the swell is tens of metres long — so the heel is a
   * degree or two, and the roll is deliberately not damped or given momentum:
   * a boat on a mooring follows the water it sits in.
   */
  private floatRowboat(waterHeight: (x: number, z: number) => number): void {
    if (!this.rowboat) return;
    const { group, x, z, heading } = this.rowboat;
    // Unit vectors for the boat's own axes, projected onto the water.
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    const halfLength = Props.BOAT_LENGTH_SCALE * Props.BOAT_BEAM_RADIUS;
    const halfBeam = Props.BOAT_BEAM_RADIUS;

    const bow = waterHeight(x + fwdX * halfLength, z + fwdZ * halfLength);
    const stern = waterHeight(x - fwdX * halfLength, z - fwdZ * halfLength);
    const starboard = waterHeight(x + fwdZ * halfBeam, z - fwdX * halfBeam);
    const port = waterHeight(x - fwdZ * halfBeam, z + fwdX * halfBeam);

    group.position.y = (bow + stern + starboard + port) * 0.25;
    // Positive rotation.x dips the bow, so the slope is negated.
    group.rotation.x = -(bow - stern) / (2 * halfLength);
    group.rotation.z = (starboard - port) / (2 * halfBeam);
  }

  /** Where the beach fire burns and how strongly, for particles and audio. */
  get campfireState(): { position: Vector3; strength: number } | null {
    if (!this.campfire) return null;
    return { position: this.campfire.position, strength: this.campfire.light.intensity / 9 };
  }

  get occluders(): Object3D[] {
    return [];
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}

/** In-game days before a harvested node comes back. */
const NODE_COOLDOWNS: Record<GatherNode['kind'], number> = {
  rock: 1,
  digSpot: 1,
  shell: 1,
  stick: 1,
  // Forage has to actually grow again, and a two-day cycle is what stops one
  // region becoming a daily vending machine.
  forage: 2,
};

/** A fan of blades with seed heads: the High Meadow's herb. */
function herbTuftGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const lean = 0.26 + (i % 3) * 0.08;
    const blade = new CylinderGeometry(0.012, 0.03, 0.52, 4);
    blade.translate(0, 0.26, 0);
    blade.rotateX(Math.sin(angle) * lean);
    blade.rotateZ(-Math.cos(angle) * lean);
    blade.translate(Math.cos(angle) * 0.07, 0, Math.sin(angle) * 0.07);
    parts.push(blade);
  }
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    const head = new SphereGeometry(0.055, 6, 5);
    head.scale(0.7, 1.5, 0.7);
    head.translate(Math.cos(angle) * 0.14, 0.52, Math.sin(angle) * 0.14);
    parts.push(head);
  }
  return mergeGeometries(parts);
}

/** Three caps at the foot of a pine: the West Grove's mushroom. */
function mushroomClumpGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const sizes = [1, 0.72, 0.5];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.8;
    const scale = sizes[i];
    const dx = Math.cos(angle) * 0.17 * (i === 0 ? 0 : 1);
    const dz = Math.sin(angle) * 0.17 * (i === 0 ? 0 : 1);

    const stem = new CylinderGeometry(0.035 * scale, 0.05 * scale, 0.26 * scale, 6);
    stem.translate(dx, 0.13 * scale, dz);
    parts.push(stem);

    const cap = new SphereGeometry(0.16 * scale, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.66, 1);
    cap.translate(dx, 0.25 * scale, dz);
    parts.push(cap);
  }
  return mergeGeometries(parts);
}

/** A low rosette of round leaves on the bank: creek cress. */
function cressTuftGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const ring = i < 5 ? 0.16 : 0.27;
    const leaf = new SphereGeometry(0.1, 7, 5);
    leaf.scale(1, 0.28, 1.25);
    leaf.rotateY(angle);
    leaf.translate(Math.cos(angle) * ring, 0.08 + (i < 5 ? 0.05 : 0), Math.sin(angle) * ring);
    parts.push(leaf);
  }
  return mergeGeometries(parts);
}
