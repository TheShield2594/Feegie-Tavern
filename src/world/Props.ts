import {
  BoxGeometry,
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
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { smoothstep } from '@/util/math';
import { makeSign, makeStreetLamp, roundedBoxGeometry } from './BuildingKit';
import { BRIDGES, ISLAND_HALF, LANDMARKS, SEA_LEVEL, sampleSurface, terrainHeight } from './heightfield';

export interface GatherNode {
  id: string;
  kind: 'rock' | 'digSpot' | 'shell' | 'stick';
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
    this.buildRocks(rng);
    this.buildDigSpots(rng);
    this.buildShells(rng);
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
    const apron = new Mesh(new CylinderGeometry(8.8, 9.1, 0.14, 48), stone);
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

  private makeBench(): Group {
    const bench = new Group();
    const wood = createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.9 });
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

    const plank = createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.92 });
    const post = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.95 });

    // Decking starts on the sand and marches out over the water.
    const deckY = 1.7;
    const bays = 9;
    for (let i = 0; i < bays; i++) {
      const z = pier.z - 3 + i * 3.0;
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

    // Mooring bollards and a rowboat.
    for (const offset of [-3.5, 3.5]) {
      const bollard = new Mesh(new CylinderGeometry(0.24, 0.3, 0.9, 10), post);
      bollard.position.set(pier.x + offset, deckY + 0.45, pier.z + 4);
      bollard.castShadow = true;
      group.add(bollard);
    }
    group.add(this.makeRowboat(pier.x + 4.8, pier.z + 13, 0.4));

    // Crates and barrels on the apron.
    const crateMaterial = createStylizedMaterial({ color: '#c49a6c', roughness: 0.92 });
    const apron = [
      { x: pier.x - 4, z: pier.z - 7, r: 0.3 },
      { x: pier.x - 2.6, z: pier.z - 5.6, r: -0.6 },
      { x: pier.x + 6, z: pier.z - 4, r: 0.9 },
    ];
    for (const spot of apron) {
      const y = terrainHeight(spot.x, spot.z);
      const crate = new Mesh(roundedBoxGeometry(1.0, 1.0, 1.0, 0.08), crateMaterial);
      crate.position.set(spot.x, y + 0.5, spot.z);
      crate.rotation.y = spot.r;
      crate.castShadow = true;
      crate.receiveShadow = true;
      group.add(crate);
      this.colliders.push({ x: spot.x, z: spot.z, radius: 0.8 });
    }

    // Lamp at the pier head.
    const lamp = makeStreetLamp({ height: 3.2 });
    lamp.group.position.set(pier.x - 2.4, deckY + 0.12, pier.z + 4);
    group.add(lamp.group);
    this.lampLights.push(lamp.light);
    this.lampGlass.push(lamp.glass);
  }

  private makeRowboat(x: number, z: number, rotation: number): Group {
    const boat = new Group();
    // Floats on the waterline rather than sitting on the terrain.
    boat.position.set(x, SEA_LEVEL + 0.52, z);
    boat.rotation.y = rotation;

    const hullMaterial = createStylizedMaterial({ color: '#d8e0e4', roughness: 0.8 });
    const trimMaterial = createStylizedMaterial({ color: '#4a7fa8', roughness: 0.8 });

    // The hull is seen from above, so it needs both faces.
    hullMaterial.side = DoubleSide;
    const hull = new Mesh(new SphereGeometry(1.3, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMaterial);
    hull.scale.set(1.0, 0.62, 2.3);
    hull.castShadow = true;
    hull.receiveShadow = true;
    boat.add(hull);

    const floorBoard = new Mesh(
      roundedBoxGeometry(1.9, 0.06, 4.4, 0.3),
      createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.9 }),
    );
    floorBoard.position.y = -0.34;
    boat.add(floorBoard);

    const rim = new Mesh(new TorusGeometry(1.28, 0.09, 6, 20), trimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1.0, 2.3, 1);
    boat.add(rim);

    for (const dz of [-0.7, 0.5]) {
      const seat = new Mesh(new BoxGeometry(2.0, 0.1, 0.34), createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.9 }));
      seat.position.set(0, 0.05, dz);
      boat.add(seat);
    }
    return boat;
  }

  // --- Bridge and stairs ---------------------------------------------------

  private buildBridge(): void {
    const plank = createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.92 });
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

    // A picket run around the farm terrace.
    const centre = LANDMARKS['farm.terrace'];
    const radius = 11;
    const count = 30;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // Leave a gap where the path arrives.
      if (a > 4.4 && a < 5.2) continue;
      const x = centre.x + Math.cos(a) * radius;
      const z = centre.z + Math.sin(a) * radius;
      const y = terrainHeight(x, z);
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
  }

  private buildBeachDressing(rng: Rng): void {
    const group = new Group();
    group.name = 'BeachDressing';
    this.group.add(group);

    // The driftwood log villagers sit on.
    const log = LANDMARKS['beach.log'];
    const logMesh = new Mesh(
      new CylinderGeometry(0.55, 0.65, 4.6, 10),
      createStylizedMaterial({ color: '#c4b49a', roughness: 0.96, flatShading: true }),
    );
    logMesh.position.set(log.x, terrainHeight(log.x, log.z) + 0.5, log.z);
    logMesh.rotation.set(0, 0.5, Math.PI / 2);
    logMesh.castShadow = true;
    logMesh.receiveShadow = true;
    group.add(logMesh);
    this.colliders.push({ x: log.x, z: log.z, radius: 1.6 });

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
    let attempts = 0;
    while (placements.length < 26 && attempts < 900) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 12);
      const z = rng.spread(ISLAND_HALF - 12);
      const sample = sampleSurface(x, z);
      if (sample.height < 1.6 || sample.slope > 0.55) continue;
      if (sample.surface === 'path' || sample.surface === 'plaza') continue;
      if (Math.hypot(x, z) < 20) continue;
      placements.push({ x, y: sample.height, z, s: rng.range(0.8, 1.6), r: rng.range(0, 6.28) });
    }

    const geometry = new IcosahedronGeometry(1, 0);
    const material = createStylizedMaterial({ color: PALETTE.rock.base, roughness: 0.96, flatShading: true });
    const mesh = new InstancedMesh(geometry, material, placements.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'Rocks';

    placements.forEach((p, i) => {
      this.dummy.position.set(p.x, p.y + 0.5 * p.s, p.z);
      this.dummy.rotation.set(rng.range(-0.3, 0.3), p.r, rng.range(-0.3, 0.3));
      this.dummy.scale.set(p.s * 1.2, p.s * 0.85, p.s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.gatherNodes.push({
        matrix: this.dummy.matrix.clone(),
        id: `rock_${i}`, kind: 'rock', x: p.x, y: p.y, z: p.z,
        harvestedOnDay: -99, index: i, hitTimer: 0,
      });
      this.colliders.push({ x: p.x, z: p.z, radius: p.s * 0.9 });
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.rockMesh = mesh;
    this.group.add(mesh);
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

  /** Hides a harvested node and shows it again once it has regrown. */
  refreshNodes(day: number): void {
    const hidden = new Vector3(0, -1000, 0);
    const cooldowns: Record<GatherNode['kind'], number> = { rock: 1, digSpot: 1, shell: 1, stick: 1 };

    for (const node of this.gatherNodes) {
      const available = day - node.harvestedOnDay >= cooldowns[node.kind];
      const mesh = node.kind === 'rock' ? this.rockMesh : node.kind === 'digSpot' ? this.digMesh : this.shellMesh;
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
      if (day - node.harvestedOnDay < 1) continue;
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  update(dt: number, darkness: number, time: number): void {
    const glow = smoothstep(0.22, 0.55, darkness);
    for (let i = 0; i < this.lampLights.length; i++) {
      // A touch of flicker keeps the lamps from looking like flat emissives.
      const flicker = 1 + Math.sin(time * 7.3 + i * 2.1) * 0.03;
      this.lampLights[i].intensity = glow * 6.0 * flicker;
      this.lampGlass[i].emissiveIntensity = glow * 2.4 * flicker;
    }
    if (this.waterTrough) {
      this.waterTrough.position.y = 0.62 + Math.sin(time * 1.4) * 0.012;
    }
    void dt;
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
