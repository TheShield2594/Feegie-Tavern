import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { kitGeometry, kitMaterial, makeKitMesh } from '@/assets/registry';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { clamp01, smoothstep } from '@/util/math';
import { gableRoofGeometry, makeSign, roundedBoxGeometry, surfaces } from './BuildingKit';
import { FORD, LANDMARKS, platformAt, terrainHeight } from './heightfield';

export interface Collider {
  x: number;
  z: number;
  radius: number;
}

/** A lamp the day/night cycle drives. */
export interface DressingLamp {
  light: PointLight;
  glass: MeshStandardMaterial;
}

export interface LandmarkDressing {
  group: Group;
  colliders: Collider[];
  signposts: { x: number; z: number; label: string }[];
  lamps: DressingLamp[];
  gate: OrchardGate;
}

/** Radius of the orchard hedge, measured from the orchard landmark. */
const ORCHARD_HEDGE_RADIUS = 8.6;

/**
 * What makes each region somewhere rather than a patch of ground.
 *
 * The heightfield shapes the island and `Props` furnishes the parts of it the
 * vertical slice already used; this is the other six places. Each one gets a
 * silhouette you can recognise from the ridge and a reason to be standing in
 * it, because a region whose only feature is a name on the map is a region
 * nobody walks to twice.
 */
export function buildRegionLandmarks(): LandmarkDressing {
  const rng = new Rng(90210);
  const group = new Group();
  group.name = 'RegionLandmarks';

  const dressing: LandmarkDressing = {
    group,
    colliders: [],
    signposts: [],
    lamps: [],
    gate: new OrchardGate(),
  };

  group.add(buildHighMeadow(rng, dressing));
  group.add(buildWestGrove(rng, dressing));
  group.add(buildSecretOrchard(rng, dressing));
  group.add(buildGardenTerrace(rng, dressing));
  group.add(buildLighthousePoint(rng, dressing));
  group.add(buildCreekCrossing(rng, dressing));

  return dressing;
}

// --- High Meadow -----------------------------------------------------------

/**
 * Standing stones on the plateau, and the pool the creek rises from.
 *
 * The stones are the thing you see from the square: five uprights on the only
 * skyline the island has, which is what turns "the flat bit above the stairs"
 * into somewhere with a name.
 */
function buildHighMeadow(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'HighMeadow';

  const centre = LANDMARKS['meadow.high'];
  const stone = createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.97, flatShading: true });
  const darkStone = createStylizedMaterial({ color: PALETTE.rock.dark, roughness: 0.97, flatShading: true });

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    const radius = 5.2;
    const x = centre.x + Math.cos(angle) * radius;
    const z = centre.z + Math.sin(angle) * radius;
    const y = terrainHeight(x, z);
    const height = rng.range(2.8, 4.1);
    const monolith = new Mesh(roundedBoxGeometry(rng.range(0.9, 1.3), height, rng.range(0.6, 0.9), 0.12), stone);
    monolith.position.set(x, y + height / 2 - 0.2, z);
    // A degree or two off vertical each: a perfectly plumb circle reads as
    // masonry, and these are meant to have been here a very long time.
    monolith.rotation.set(rng.range(-0.06, 0.06), angle + rng.range(-0.3, 0.3), rng.range(-0.05, 0.05));
    monolith.castShadow = true;
    monolith.receiveShadow = true;
    group.add(monolith);
    out.colliders.push({ x, z, radius: 0.8 });
  }

  // A flat altar stone in the middle, low enough to sit on.
  const altarY = terrainHeight(centre.x, centre.z);
  const altar = new Mesh(roundedBoxGeometry(2.6, 0.5, 1.5, 0.14), darkStone);
  altar.position.set(centre.x, altarY + 0.25, centre.z);
  altar.rotation.y = 0.3;
  altar.castShadow = true;
  altar.receiveShadow = true;
  group.add(altar);
  out.colliders.push({ x: centre.x, z: centre.z, radius: 1.3 });

  // The spring: a cairn on the bank of the pool the creek starts as.
  const spring = LANDMARKS['meadow.spring'];
  for (let i = 0; i < 6; i++) {
    const x = spring.x + rng.range(-1.1, 1.1);
    const z = spring.z + rng.range(-1.1, 1.1);
    const size = rng.range(0.22, 0.46) * (1 - i * 0.1);
    const cobble = new Mesh(new IcosahedronGeometry(size, 0), stone);
    cobble.position.set(x, terrainHeight(x, z) + size * 0.6 + i * 0.28, z);
    cobble.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    cobble.castShadow = true;
    group.add(cobble);
  }
  out.signposts.push({ x: spring.x, z: spring.z, label: 'Meadow Spring' });

  // A bench on the southern lip, facing the whole island.
  const viewX = centre.x + 7;
  const viewZ = centre.z + 6;
  group.add(makeLogSeat(viewX, viewZ, Math.atan2(centre.x - viewX, centre.z - viewZ) + Math.PI));
  out.colliders.push({ x: viewX, z: viewZ, radius: 1.1 });

  return group;
}

// --- West Grove ------------------------------------------------------------

/**
 * The elder tree and the lanterns somebody keeps lit around it.
 *
 * Deliberately bigger than anything `Foliage` scatters: the grove needs one
 * tree that is obviously *the* tree, or it is just more forest.
 */
function buildWestGrove(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'WestGrove';

  const elder = LANDMARKS['grove.elder'];
  const baseY = terrainHeight(elder.x, elder.z);
  const bark = createStylizedMaterial({ color: PALETTE.foliage.barkDark, roughness: 0.96, flatShading: true });
  const moss = createStylizedMaterial({ color: PALETTE.grass.moss, roughness: 0.94, flatShading: true });
  const canopy = createStylizedMaterial({ color: PALETTE.foliage.canopyDark, roughness: 0.9, flatShading: true });

  // A hollow trunk: two half-shells with a gap, so it reads as something you
  // could step inside rather than a fat cylinder.
  for (let i = 0; i < 7; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.55;
    const lean = rng.range(0.02, 0.09);
    const slab = new Mesh(new CylinderGeometry(0.42, 0.58, rng.range(5.2, 6.6), 6), bark);
    slab.position.set(
      elder.x + Math.cos(angle) * 1.35,
      baseY + 2.9,
      elder.z + Math.sin(angle) * 1.35,
    );
    slab.rotation.set(Math.cos(angle) * lean, angle, Math.sin(angle) * -lean);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
  }

  for (let i = 0; i < 4; i++) {
    const blob = new Mesh(new IcosahedronGeometry(rng.range(2.6, 3.8), 1), canopy);
    blob.position.set(
      elder.x + rng.range(-2.4, 2.4),
      baseY + rng.range(6.4, 8.2),
      elder.z + rng.range(-2.4, 2.4),
    );
    blob.scale.y = 0.72;
    blob.castShadow = true;
    group.add(blob);
  }

  // Moss skirting the roots.
  for (let i = 0; i < 5; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const x = elder.x + Math.cos(angle) * rng.range(1.6, 2.8);
    const z = elder.z + Math.sin(angle) * rng.range(1.6, 2.8);
    const root = new Mesh(new SphereGeometry(rng.range(0.5, 0.85), 8, 6), moss);
    root.scale.y = 0.42;
    root.position.set(x, terrainHeight(x, z) + 0.1, z);
    group.add(root);
  }
  out.colliders.push({ x: elder.x, z: elder.z, radius: 2.2 });

  // Lanterns on posts, and the offering slab between them. These are the only
  // lit thing west of the square, so the grove has a look after dark.
  const clearing = LANDMARKS['grove.west'];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 1.1;
    const x = clearing.x + Math.cos(angle) * 4.4;
    const z = clearing.z + Math.sin(angle) * 4.4;
    group.add(makeLanternPost(x, z, out));
    out.colliders.push({ x, z, radius: 0.4 });
  }

  const slabY = terrainHeight(clearing.x, clearing.z);
  const slab = new Mesh(roundedBoxGeometry(1.8, 0.34, 1.2, 0.1), createStylizedMaterial({
    color: PALETTE.rock.base,
    roughness: 0.96,
    flatShading: true,
  }));
  slab.position.set(clearing.x, slabY + 0.17, clearing.z);
  slab.rotation.y = 0.5;
  slab.receiveShadow = true;
  slab.castShadow = true;
  group.add(slab);

  for (const [dx, dz, r] of [[-3.4, 2.6, 0.9], [3.1, -2.2, -0.4]] as const) {
    group.add(makeLogSeat(clearing.x + dx, clearing.z + dz, r));
    out.colliders.push({ x: clearing.x + dx, z: clearing.z + dz, radius: 1.1 });
  }

  out.signposts.push({ x: clearing.x, z: clearing.z + 5.6, label: 'West Grove' });
  return group;
}

// --- Secret Orchard --------------------------------------------------------

/**
 * A hedge ring with one way in.
 *
 * The orchard was only ever "secret" on the map. A hedge you cannot push
 * through and a gate you cannot open until you have the key is what makes the
 * name true, and makes finding it worth something.
 */
function buildSecretOrchard(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'SecretOrchard';

  const centre = LANDMARKS['orchard.secret'];
  const gate = LANDMARKS['orchard.gate'];
  const gateAngle = Math.atan2(gate.z - centre.z, gate.x - centre.x);

  const hedgeGeometry = kitGeometry('yard.hedge');
  const hedgeMaterial = hedgeGeometry
    ? kitMaterial({ roughness: 0.95, tint: '#cfe0b4' })
    : createStylizedMaterial({ color: PALETTE.foliage.canopyMid, roughness: 0.95, flatShading: true });
  const segment = hedgeGeometry ? 2.4 : 2.2;
  const count = Math.round((Math.PI * 2 * ORCHARD_HEDGE_RADIUS) / segment);

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    // Leave the gateway clear.
    let delta = Math.abs(angle - (gateAngle < 0 ? gateAngle + Math.PI * 2 : gateAngle));
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta < 0.21) continue;

    const x = centre.x + Math.cos(angle) * ORCHARD_HEDGE_RADIUS;
    const z = centre.z + Math.sin(angle) * ORCHARD_HEDGE_RADIUS;
    const y = terrainHeight(x, z);

    if (hedgeGeometry) {
      const run = new Mesh(hedgeGeometry, hedgeMaterial);
      run.position.set(x, y - 0.02, z);
      run.rotation.y = -angle;
      // The kit hedge is a quarter of a grid cell tall — a kerb at the scale
      // everything else uses, and a hedge you can see over is not an enclosure.
      // Scaled to stand a little over two metres, which is the whole point of
      // it, with a few centimetres of variation so the top is not a ruled line.
      run.scale.set(segment, segment * rng.range(3.3, 3.6), segment);
      run.castShadow = true;
      run.receiveShadow = true;
      group.add(run);
    } else {
      const block = new Mesh(roundedBoxGeometry(2.2, rng.range(2.1, 2.5), 1.1, 0.4), hedgeMaterial);
      block.position.set(x, y + 1.15, z);
      block.rotation.y = -angle;
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
    }
    out.colliders.push({ x, z, radius: 1.15 });
  }

  group.add(out.gate.build(gate.x, gate.z, gateAngle));

  // Inside: somewhere to put the basket down, and a ladder left against a tree.
  const benchX = centre.x - 2.4;
  const benchZ = centre.z + 3.1;
  group.add(makeLogSeat(benchX, benchZ, 0.9));
  out.colliders.push({ x: benchX, z: benchZ, radius: 1.1 });

  const crate = makeKitMesh('props.crate', { scale: 1.2, roughness: 0.9 });
  if (crate) {
    crate.position.set(centre.x + 2.2, terrainHeight(centre.x + 2.2, centre.z - 1.4), centre.z - 1.4);
    crate.rotation.y = 0.6;
    group.add(crate);
    out.colliders.push({ x: centre.x + 2.2, z: centre.z - 1.4, radius: 0.6 });
  }

  const ladderWood = createStylizedMaterial({ color: PALETTE.wood.plankDark, roughness: 0.94 });
  const ladder = new Group();
  for (const side of [-0.34, 0.34]) {
    const rail = new Mesh(new BoxGeometry(0.09, 3.6, 0.09), ladderWood);
    rail.position.set(side, 1.8, 0);
    rail.castShadow = true;
    ladder.add(rail);
  }
  for (let i = 0; i < 7; i++) {
    const rung = new Mesh(new BoxGeometry(0.76, 0.07, 0.07), ladderWood);
    rung.position.set(0, 0.5 + i * 0.45, 0);
    ladder.add(rung);
  }
  const ladderX = centre.x + 4.4;
  const ladderZ = centre.z + 2.8;
  ladder.position.set(ladderX, terrainHeight(ladderX, ladderZ), ladderZ);
  ladder.rotation.set(-0.22, 1.1, 0);
  group.add(ladder);

  return group;
}

/**
 * The orchard's gate: two leaves that swing, and a bar across the gap until
 * they do.
 *
 * The lock is the region's whole premise, so the gate owns both halves of it —
 * the animation and the thing standing in the player's way — and `Props`
 * publishes the collider so movement can drop it the moment the gate opens.
 */
export class OrchardGate {
  readonly group = new Group();
  /** The circle that blocks the gap. Removed from the world's colliders when open. */
  readonly collider: Collider = { x: 0, z: 0, radius: 1.75 };
  /** Where the prompt anchors. */
  x = 0;
  z = 0;
  y = 0;

  private leaves: Object3D[] = [];
  private bar: Object3D | null = null;
  private openness = 0;
  private target = 0;

  get isOpen(): boolean {
    return this.target > 0.5;
  }

  build(x: number, z: number, outwardAngle: number): Group {
    this.x = x;
    this.z = z;
    this.y = terrainHeight(x, z);
    this.collider.x = x;
    this.collider.z = z;
    this.group.name = 'OrchardGate';
    this.group.position.set(x, this.y, z);
    // Face the leaves along the hedge line, not out of it.
    this.group.rotation.y = -outwardAngle;

    const post = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.94 });
    const plank = surfaces.plank(PALETTE.wood.plankDark, 1.1);

    for (const side of [-1, 1]) {
      const pillar = new Mesh(new CylinderGeometry(0.17, 0.2, 2.5, 8), post);
      pillar.position.set(0, 1.25, side * 1.85);
      pillar.castShadow = true;
      this.group.add(pillar);

      const cap = new Mesh(new ConeGeometry(0.26, 0.3, 8), post);
      cap.position.set(0, 2.62, side * 1.85);
      this.group.add(cap);

      // Each leaf hangs off its own pivot so it can swing inward.
      const pivot = new Group();
      pivot.position.set(0, 0, side * 1.75);
      this.group.add(pivot);
      this.leaves.push(pivot);

      const leaf = new Group();
      leaf.position.set(0, 0, side * 0.85);
      pivot.add(leaf);

      for (let i = 0; i < 4; i++) {
        const slat = new Mesh(roundedBoxGeometry(0.1, 1.9, 0.16, 0.04), plank);
        slat.position.set(0, 1.05, side * (-0.6 + i * 0.4));
        slat.castShadow = true;
        leaf.add(slat);
      }
      for (const railY of [0.55, 1.55]) {
        const rail = new Mesh(new BoxGeometry(0.1, 0.12, 1.7), plank);
        rail.position.set(0, railY, 0);
        rail.castShadow = true;
        leaf.add(rail);
      }
    }

    // The bar and its padlock, which is the part the player reads as "locked".
    const bar = new Group();
    const beam = new Mesh(new BoxGeometry(0.14, 0.18, 3.4), post);
    beam.position.y = 1.1;
    beam.castShadow = true;
    bar.add(beam);
    const lock = new Mesh(
      new TorusGeometry(0.14, 0.045, 6, 14),
      createStylizedMaterial({ color: '#b89a5c', roughness: 0.5, metalness: 0.6 }),
    );
    lock.position.set(0.12, 1.26, 0);
    lock.rotation.y = Math.PI / 2;
    bar.add(lock);
    this.group.add(bar);
    this.bar = bar;

    const sign = makeSign({ text: 'Private', width: 1.1, height: 0.36, boardColor: '#d8c6a0' });
    sign.position.set(0.22, 1.75, 0);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    return this.group;
  }

  /** Opens or shuts the gate. `instant` is for restoring a save. */
  setOpen(open: boolean, instant = false): void {
    this.target = open ? 1 : 0;
    if (instant) {
      this.openness = this.target;
      this.apply();
    }
  }

  update(dt: number): void {
    if (Math.abs(this.openness - this.target) < 0.001) return;
    // Slow: a heavy gate, and the player should get to watch it happen.
    this.openness += Math.sign(this.target - this.openness) * Math.min(dt * 0.9, Math.abs(this.target - this.openness));
    this.apply();
  }

  private apply(): void {
    const swing = smoothstep(0, 1, clamp01(this.openness));
    this.leaves.forEach((pivot, index) => {
      pivot.rotation.y = (index === 0 ? 1 : -1) * swing * 1.65;
    });
    if (this.bar) {
      this.bar.visible = swing < 0.02;
    }
  }
}

// --- Garden Terrace --------------------------------------------------------

/**
 * A shed, a scarecrow and a compost heap: the difference between a fenced pad
 * of dirt and somewhere somebody gardens.
 */
function buildGardenTerrace(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'GardenTerrace';

  const shed = LANDMARKS['garden.shed'];
  const shedY = terrainHeight(shed.x, shed.z);
  const timber = surfaces.plank(PALETTE.wood.plank, 1.3);
  const trim = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.94 });

  const body = new Mesh(roundedBoxGeometry(3.2, 2.3, 2.6, 0.08), timber);
  body.position.set(shed.x, shedY + 1.15, shed.z);
  body.rotation.y = 0.35;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new Mesh(gableRoofGeometry(3.6, 3.0, 0.9, 0.35), createStylizedMaterial({
    color: PALETTE.roof.moss,
    roughness: 0.92,
    flatShading: true,
  }));
  roof.position.set(shed.x, shedY + 2.3, shed.z);
  roof.rotation.y = 0.35;
  roof.castShadow = true;
  group.add(roof);

  const door = new Mesh(roundedBoxGeometry(0.9, 1.7, 0.1, 0.04), trim);
  door.position.set(shed.x + Math.sin(0.35) * 1.32, shedY + 0.85, shed.z + Math.cos(0.35) * 1.32);
  door.rotation.y = 0.35;
  group.add(door);
  out.colliders.push({ x: shed.x, z: shed.z, radius: 2.1 });
  out.signposts.push({ x: shed.x, z: shed.z + 2.6, label: 'Garden Terrace' });

  // Tools leaning on the shed wall, because a shed with nothing outside it
  // looks like a model of a shed.
  for (const id of ['tools.shovel', 'tools.axe']) {
    const tool = makeKitMesh(id, { scale: 1.0, roughness: 0.85 });
    if (!tool) continue;
    const tx = shed.x - 1.5 + rng.range(-0.2, 0.2);
    const tz = shed.z + 1.3 + rng.range(-0.2, 0.2);
    tool.position.set(tx, terrainHeight(tx, tz) + 0.5, tz);
    tool.rotation.set(0.32, rng.range(0, 6.28), 0.1);
    group.add(tool);
  }

  // The scarecrow, out among the rows.
  const scareX = LANDMARKS['farm.terrace'].x - 4.5;
  const scareZ = LANDMARKS['farm.terrace'].z + 5.5;
  group.add(makeScarecrow(scareX, scareZ));
  out.colliders.push({ x: scareX, z: scareZ, radius: 0.5 });

  // Compost, and the barrels that catch the roof runoff. Kept on the shed's
  // dry side: the creek runs within a couple of metres of the other one, and a
  // compost heap standing in the stream is not a gardener's compost heap.
  const compostX = shed.x - 3.0;
  const compostZ = shed.z - 2.6;
  const compost = new Mesh(
    new SphereGeometry(1.05, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2),
    createStylizedMaterial({ color: PALETTE.dirt.tilled, roughness: 0.99, flatShading: true }),
  );
  compost.scale.y = 0.55;
  compost.position.set(compostX, terrainHeight(compostX, compostZ) + 0.08, compostZ);
  compost.castShadow = true;
  compost.receiveShadow = true;
  group.add(compost);
  // Four boards on edge around it, which is what makes it a compost bin rather
  // than a mound of soil.
  const compostY = terrainHeight(compostX, compostZ);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const board = new Mesh(roundedBoxGeometry(2.3, 0.75, 0.09, 0.03), timber);
    board.position.set(
      compostX + Math.cos(angle) * 1.15,
      compostY + 0.36,
      compostZ + Math.sin(angle) * 1.15,
    );
    board.rotation.y = -angle + Math.PI / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);
  }
  out.colliders.push({ x: compostX, z: compostZ, radius: 1.3 });

  for (let i = 0; i < 2; i++) {
    const barrel = makeKitMesh('props.barrel', { scale: 1.25, roughness: 0.9 });
    if (!barrel) break;
    const bx = shed.x - 2.3 - i * 1.2;
    const bz = shed.z - 1.4;
    barrel.position.set(bx, terrainHeight(bx, bz), bz);
    group.add(barrel);
    out.colliders.push({ x: bx, z: bz, radius: 0.55 });
  }

  return group;
}

// --- Lighthouse Point ------------------------------------------------------

/**
 * The keeper's camp and a spyglass on the cliff edge.
 *
 * The tower was already here and already worked; what the point had no reason
 * to offer was anything to do while you were standing under it.
 */
function buildLighthousePoint(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'LighthousePoint';

  const camp = LANDMARKS['point.keeper'];
  const campY = terrainHeight(camp.x, camp.z);

  const tent = makeKitMesh('props.tent', { scale: 1.8, roughness: 0.9 });
  if (tent) {
    tent.position.set(camp.x, campY, camp.z);
    tent.rotation.y = -0.7;
    group.add(tent);
  } else {
    const canvas = new Mesh(
      new ConeGeometry(2.1, 2.4, 4),
      createStylizedMaterial({ color: '#d8cbb0', roughness: 0.95, flatShading: true }),
    );
    canvas.position.set(camp.x, campY + 1.2, camp.z);
    canvas.rotation.y = Math.PI / 4;
    canvas.castShadow = true;
    group.add(canvas);
  }
  out.colliders.push({ x: camp.x, z: camp.z, radius: 1.7 });

  // A brazier rather than a campfire: the beach already owns the one fire the
  // particle system tracks, and this only needs to glow after dark.
  const brazierX = camp.x + 2.8;
  const brazierZ = camp.z + 1.6;
  group.add(makeBrazier(brazierX, brazierZ, out));
  out.colliders.push({ x: brazierX, z: brazierZ, radius: 0.7 });

  // Lobster pots and crates, stacked the way gear gets stacked.
  for (let i = 0; i < 3; i++) {
    const px = camp.x - 2.6 + rng.range(-0.8, 0.8);
    const pz = camp.z - 2.2 + i * 1.4;
    const y = terrainHeight(px, pz);
    const pot = new Group();
    for (let ring = 0; ring < 3; ring++) {
      const hoop = new Mesh(
        new TorusGeometry(0.52 - ring * 0.06, 0.05, 5, 12),
        createStylizedMaterial({ color: '#9a7f52', roughness: 0.95 }),
      );
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = 0.12 + ring * 0.22;
      pot.add(hoop);
    }
    const mesh = new Mesh(
      new CylinderGeometry(0.5, 0.54, 0.62, 10, 1, true),
      createStylizedMaterial({ color: '#7f6a48', roughness: 0.98, flatShading: true }),
    );
    mesh.position.y = 0.33;
    pot.add(mesh);
    pot.position.set(px, y, pz);
    pot.rotation.y = rng.range(0, 6.28);
    pot.children.forEach((c) => { (c as Mesh).castShadow = true; });
    group.add(pot);
    out.colliders.push({ x: px, z: pz, radius: 0.6 });
  }

  for (let i = 0; i < 2; i++) {
    const crate = makeKitMesh(i ? 'props.barrel' : 'props.crate', { scale: 1.2, roughness: 0.9 });
    if (!crate) break;
    const cx = camp.x + 1.4 + i * 1.3;
    const cz = camp.z - 2.6;
    crate.position.set(cx, terrainHeight(cx, cz), cz);
    crate.rotation.y = rng.range(0, 6.28);
    group.add(crate);
    out.colliders.push({ x: cx, z: cz, radius: 0.6 });
  }

  // The spyglass, out on the seaward lip where the view actually is.
  const lookout = LANDMARKS['lighthouse.point'];
  const glassX = lookout.x - 3.4;
  const glassZ = lookout.z + 7.2;
  group.add(makeSpyglass(glassX, glassZ, Math.PI));
  out.colliders.push({ x: glassX, z: glassZ, radius: 0.6 });
  out.signposts.push({ x: glassX, z: glassZ + 1.6, label: 'Lighthouse Point' });

  return group;
}

// --- The creek -------------------------------------------------------------

/** Stepping stones where the west road fords the stream. */
function buildCreekCrossing(rng: Rng, out: LandmarkDressing): Group {
  const group = new Group();
  group.name = 'CreekFord';

  const stone = createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.97, flatShading: true });
  // The heightfield already decided what height the crossing walks at, so read
  // it back rather than recomputing: slabs that disagree with the surface the
  // player stands on are the one thing nobody forgives.
  const deck = platformAt(FORD.x, FORD.z)?.height ?? terrainHeight(FORD.x, FORD.z);

  // Seven boulders with water between them, rather than one continuous kerb:
  // the gaps are what make it read as stepping stones you hop across.
  for (let i = 0; i < 7; i++) {
    const t = i / 6 - 0.5;
    const x = FORD.x + t * 2 * (FORD.halfW - 1.0);
    const z = FORD.z + (i % 2 === 0 ? 0.42 : -0.42) + rng.range(-0.22, 0.22);
    const size = rng.range(0.62, 0.82);
    const slab = new Mesh(new IcosahedronGeometry(size, 0), stone);
    // Squashed and half-sunk: the flat top sits level with the surface the
    // player walks on, the rest disappears into the streambed.
    slab.scale.set(1.15, 0.72, 1.05);
    slab.position.set(x, deck - size * 0.5, z);
    slab.rotation.set(rng.range(-0.12, 0.12), rng.range(0, 6.28), rng.range(-0.12, 0.12));
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
  }

  out.signposts.push({ x: FORD.x, z: FORD.z - 3.6, label: 'The Creek' });
  return group;
}

// --- Shared pieces ---------------------------------------------------------

/** A felled log with the top planed flat: the island's default seat. */
function makeLogSeat(x: number, z: number, rotation: number): Group {
  const group = new Group();
  const wood = createStylizedMaterial({ color: PALETTE.foliage.bark, roughness: 0.96, flatShading: true });
  const top = createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.92 });

  const log = new Mesh(new CylinderGeometry(0.42, 0.46, 2.6, 10), wood);
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.38;
  log.castShadow = true;
  log.receiveShadow = true;
  group.add(log);

  const seat = new Mesh(roundedBoxGeometry(2.5, 0.1, 0.62, 0.04), top);
  seat.position.y = 0.74;
  seat.receiveShadow = true;
  group.add(seat);

  group.position.set(x, terrainHeight(x, z), z);
  group.rotation.y = rotation;
  return group;
}

/**
 * A post lantern. Registers its light and its glass with the dressing so the
 * same day/night driver `Props` already runs can turn it on.
 */
function makeLanternPost(x: number, z: number, out: LandmarkDressing): Group {
  const group = new Group();
  group.position.set(x, terrainHeight(x, z), z);

  const post = new Mesh(
    new CylinderGeometry(0.07, 0.09, 2.1, 8),
    createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.94 }),
  );
  post.position.y = 1.05;
  post.castShadow = true;
  group.add(post);

  const arm = new Mesh(new BoxGeometry(0.46, 0.07, 0.07), createStylizedMaterial({
    color: PALETTE.wood.beam,
    roughness: 0.94,
  }));
  arm.position.set(0.2, 2.02, 0);
  group.add(arm);

  const glass = new MeshStandardMaterial({
    color: 0xffe2ad,
    emissive: 0xffb864,
    emissiveIntensity: 0,
    roughness: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const lamp = new Mesh(new SphereGeometry(0.19, 10, 8), glass);
  lamp.position.set(0.4, 1.84, 0);
  group.add(lamp);

  const cap = new Mesh(new ConeGeometry(0.24, 0.24, 8), createStylizedMaterial({
    color: PALETTE.rock.dark,
    roughness: 0.7,
    metalness: 0.3,
  }));
  cap.position.set(0.4, 2.06, 0);
  group.add(cap);

  const light = new PointLight(0xffc27a, 0, 9, 2);
  light.position.set(0.4, 1.84, 0);
  group.add(light);
  out.lamps.push({ light, glass });

  return group;
}

/** A scarecrow: crossed stakes, a sack head and a hat that has seen weather. */
function makeScarecrow(x: number, z: number): Group {
  const group = new Group();
  group.position.set(x, terrainHeight(x, z), z);

  const stake = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.95 });
  const post = new Mesh(new CylinderGeometry(0.08, 0.1, 2.3, 7), stake);
  post.position.y = 1.15;
  post.castShadow = true;
  group.add(post);

  const arms = new Mesh(new BoxGeometry(1.9, 0.09, 0.09), stake);
  arms.position.y = 1.6;
  arms.rotation.z = 0.08;
  arms.castShadow = true;
  group.add(arms);

  const shirt = new Mesh(roundedBoxGeometry(1.0, 0.8, 0.42, 0.12), createStylizedMaterial({
    color: '#c46f5c',
    roughness: 0.95,
  }));
  shirt.position.y = 1.38;
  shirt.castShadow = true;
  group.add(shirt);

  const head = new Mesh(new SphereGeometry(0.28, 10, 8), createStylizedMaterial({
    color: '#d9c08a',
    roughness: 0.96,
  }));
  head.scale.y = 1.12;
  head.position.y = 2.0;
  head.castShadow = true;
  group.add(head);

  const brim = new Mesh(new CylinderGeometry(0.52, 0.52, 0.05, 12), createStylizedMaterial({
    color: '#b09055',
    roughness: 0.96,
  }));
  brim.position.y = 2.2;
  brim.rotation.z = 0.12;
  brim.castShadow = true;
  group.add(brim);

  const crown = new Mesh(new ConeGeometry(0.27, 0.3, 10), createStylizedMaterial({
    color: '#b09055',
    roughness: 0.96,
  }));
  crown.position.y = 2.35;
  crown.rotation.z = 0.12;
  group.add(crown);

  // Straw at the cuffs, which is what makes it read as a scarecrow at a glance.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const straw = new Mesh(new CylinderGeometry(0.02, 0.01, 0.34, 4), createStylizedMaterial({
        color: '#d9c479',
        roughness: 0.98,
      }));
      straw.position.set(side * 0.92, 1.52 - i * 0.04, (i - 1) * 0.06);
      straw.rotation.set(0.2, 0, side * 0.7 + (i - 1) * 0.2);
      group.add(straw);
    }
  }

  return group;
}

/** A brazier on three legs, lit after dark. */
function makeBrazier(x: number, z: number, out: LandmarkDressing): Group {
  const group = new Group();
  group.position.set(x, terrainHeight(x, z), z);

  const iron = createStylizedMaterial({ color: '#4a4a4f', roughness: 0.62, metalness: 0.45 });
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const leg = new Mesh(new CylinderGeometry(0.05, 0.04, 0.95, 6), iron);
    leg.position.set(Math.cos(angle) * 0.24, 0.46, Math.sin(angle) * 0.24);
    leg.rotation.set(Math.sin(angle) * 0.24, 0, -Math.cos(angle) * 0.24);
    leg.castShadow = true;
    group.add(leg);
  }

  const bowl = new Mesh(new CylinderGeometry(0.58, 0.36, 0.42, 12), iron);
  bowl.position.y = 1.1;
  bowl.castShadow = true;
  group.add(bowl);

  const glass = new MeshStandardMaterial({
    color: 0xffa040,
    emissive: 0xff7a22,
    emissiveIntensity: 0,
    roughness: 0.6,
  });
  const embers = new Mesh(new SphereGeometry(0.42, 10, 8), glass);
  embers.scale.set(1.05, 0.5, 1.05);
  embers.position.y = 1.26;
  group.add(embers);

  const light = new PointLight(0xff9a4a, 0, 12, 2);
  light.position.y = 1.5;
  group.add(light);
  out.lamps.push({ light, glass });

  return group;
}

/** A spyglass on a tripod, aimed out to sea. */
function makeSpyglass(x: number, z: number, rotation: number): Group {
  const group = new Group();
  group.position.set(x, terrainHeight(x, z), z);
  group.rotation.y = rotation;

  const brass = createStylizedMaterial({ color: '#c0964e', roughness: 0.4, metalness: 0.65 });
  const wood = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.94 });

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new Mesh(new CylinderGeometry(0.05, 0.035, 1.5, 6), wood);
    leg.position.set(Math.cos(angle) * 0.32, 0.72, Math.sin(angle) * 0.32);
    leg.rotation.set(Math.sin(angle) * 0.42, 0, -Math.cos(angle) * 0.42);
    leg.castShadow = true;
    group.add(leg);
  }

  const head = new Mesh(new SphereGeometry(0.12, 10, 8), brass);
  head.position.y = 1.44;
  group.add(head);

  const barrel = new Mesh(new CylinderGeometry(0.13, 0.17, 1.0, 12), brass);
  barrel.position.set(0, 1.56, 0.26);
  barrel.rotation.x = Math.PI / 2 - 0.22;
  barrel.castShadow = true;
  group.add(barrel);

  const eyepiece = new Mesh(new CylinderGeometry(0.09, 0.11, 0.24, 10), brass);
  eyepiece.position.set(0, 1.68, -0.22);
  eyepiece.rotation.x = Math.PI / 2 - 0.22;
  group.add(eyepiece);

  return group;
}
