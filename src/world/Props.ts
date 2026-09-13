import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
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
import { BRIDGES, ISLAND_HALF, LANDMARKS, sampleSurface, terrainHeight } from './heightfield';

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

    const pool = new Mesh(new CylinderGeometry(2.92, 2.92, 0.1, 24), water);
    pool.position.y = 0.62;
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

    const spout = new Mesh(new SphereGeometry(0.3, 12, 10), stoneDark);
    spout.position.y = 2.62;
    square.add(spout);
    this.colliders.push({ x: centre.x, z: centre.z, radius: 3.5 });

    // Paving ring around the fountain, laid as radial slabs.
    const slab = roundedBoxGeometry(2.2, 0.12, 1.5, 0.1);
    const slabMesh = new InstancedMesh(slab, stoneDark, 40);
    slabMesh.receiveShadow = true;
    for (let ring = 0; ring < 2; ring++) {
      const radius = 5.2 + ring * 2.6;
      const count = 16 + ring * 4;
      for (let i = 0; i < count && ring * 20 + i < 40; i++) {
        const a = (i / count) * Math.PI * 2 + ring * 0.2;
        this.dummy.position.set(Math.cos(a) * radius, 0.04, Math.sin(a) * radius);
        this.dummy.rotation.set(0, -a, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        slabMesh.setMatrixAt(ring * 20 + i, this.dummy.matrix);
      }
    }
    slabMesh.instanceMatrix.needsUpdate = true;
    square.add(slabMesh);

    // Notice board.
    const board = makeSign({ text: 'Cozy Cove', width: 2.6, height: 1.5, boardColor: '#f2e2c4' });
    board.position.set(-8.5, 1.9, 3.4);
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
    this.colliders.push({ x: centre.x - 8.5, z: centre.z + 3.4, radius: 1.4 });

    // Benches around the square.
    const benchSpots = [
      { x: 7, z: 6, r: -0.8 },
      { x: -7, z: -6.5, r: 2.4 },
      { x: 8.5, z: -5, r: -2.1 },
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
    const bedSpots = [{ x: -8, z: 6 }, { x: 9, z: 2 }, { x: -3, z: -9 }];
    bedSpots.forEach((spot, bedIndex) => {
      const bed = new Mesh(roundedBoxGeometry(3.4, 0.28, 2.0, 0.4), bedMaterial);
      bed.position.set(spot.x, 0.12, spot.z);
      bed.receiveShadow = true;
      square.add(bed);
      for (let i = 0; i < 9; i++) {
        const bloom = new Mesh(new SphereGeometry(0.16, 7, 6), bloomMaterials[(i + bedIndex) % bloomMaterials.length]);
        bloom.position.set(spot.x - 1.3 + (i % 5) * 0.65, 0.42, spot.z - 0.5 + Math.floor(i / 5) * 0.7);
        bloom.castShadow = true;
        square.add(bloom);
      }
    });

    // Square lamps.
    for (const spot of [{ x: -5.5, z: 8.5 }, { x: 6, z: 9 }, { x: -9.5, z: -3 }, { x: 10, z: -6 }]) {
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

    // Decking marches out over the water, with pilings under each bay.
    const bays = 9;
    for (let i = 0; i < bays; i++) {
      const z = pier.z - 6 + i * 3.0;
      const deck = new Mesh(roundedBoxGeometry(5.2, 0.24, 3.0, 0.06), plank);
      deck.position.set(pier.x, 1.05, z);
      deck.castShadow = true;
      deck.receiveShadow = true;
      group.add(deck);

      for (const dx of [-2.1, 2.1]) {
        const piling = new Mesh(new CylinderGeometry(0.22, 0.26, 5.5, 8), post);
        piling.position.set(pier.x + dx, -1.6, z);
        piling.castShadow = true;
        group.add(piling);

        if (i % 2 === 0) {
          const rail = new Mesh(new BoxGeometry(0.12, 0.9, 0.12), post);
          rail.position.set(pier.x + dx, 1.6, z);
          rail.castShadow = true;
          group.add(rail);
        }
      }
      if (i > 0) {
        for (const dx of [-2.1, 2.1]) {
          const beam = new Mesh(new BoxGeometry(0.1, 0.1, 3.0), post);
          beam.position.set(pier.x + dx, 2.0, z - 1.5);
          group.add(beam);
        }
      }
    }

    // Mooring bollards and a rowboat.
    for (const offset of [-3.5, 3.5]) {
      const bollard = new Mesh(new CylinderGeometry(0.24, 0.3, 0.9, 10), post);
      bollard.position.set(pier.x + offset, 1.55, pier.z + 2);
      bollard.castShadow = true;
      group.add(bollard);
    }
    group.add(this.makeRowboat(pier.x + 4.6, pier.z - 1, 0.4));

    // Crates and barrels on the apron.
    const crateMaterial = createStylizedMaterial({ color: '#c49a6c', roughness: 0.92 });
    for (const spot of [{ x: 8, z: 40, r: 0.3 }, { x: 9.4, z: 41.4, r: -0.6 }, { x: 19, z: 43, r: 0.9 }]) {
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
    lamp.group.position.set(pier.x - 2.4, 1.2, pier.z + 4);
    group.add(lamp.group);
    this.lampLights.push(lamp.light);
    this.lampGlass.push(lamp.glass);
  }

  private makeRowboat(x: number, z: number, rotation: number): Group {
    const boat = new Group();
    boat.position.set(x, 0.05, z);
    boat.rotation.y = rotation;

    const hullMaterial = createStylizedMaterial({ color: '#d8e0e4', roughness: 0.8 });
    const trimMaterial = createStylizedMaterial({ color: '#4a7fa8', roughness: 0.8 });

    const hull = new Mesh(new SphereGeometry(1.3, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMaterial);
    hull.scale.set(1.0, 0.62, 2.3);
    hull.castShadow = true;
    boat.add(hull);

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

    const start = { x: -36, z: -30 };
    const end = { x: -46, z: -41 };
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
    for (let i = 0; i < 2; i++) {
      const x = -14 - i * 7 + rng.spread(2);
      const z = 36 + rng.spread(3);
      const y = terrainHeight(x, z);
      const pole = new Mesh(new CylinderGeometry(0.06, 0.06, 2.4, 8), createStylizedMaterial({ color: '#e8dcc0', roughness: 0.8 }));
      pole.position.set(x, y + 1.2, z);
      pole.castShadow = true;
      group.add(pole);

      const canopy = new Mesh(
        new SphereGeometry(1.6, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2.6),
        createStylizedMaterial({ color: i ? '#f2946b' : '#7fc9de', roughness: 0.86, side: undefined }),
      );
      canopy.position.set(x, y + 2.3, z);
      canopy.castShadow = true;
      group.add(canopy);
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
    const geometry = new SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const material = createStylizedMaterial({ color: '#f4e2c8', roughness: 0.6 });
    const count = 18;
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.name = 'BeachShells';

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 900) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 20);
      const z = rng.range(22, ISLAND_HALF - 20);
      const sample = sampleSurface(x, z);
      if (sample.surface !== 'sand' || sample.height < 0.15 || sample.height > 1.3) continue;
      this.dummy.position.set(x, sample.height + 0.05, z);
      this.dummy.rotation.set(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2));
      this.dummy.scale.setScalar(rng.range(0.8, 1.4));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      this.gatherNodes.push({
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
