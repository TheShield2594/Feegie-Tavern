import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three';
import { kitGeometry } from '@/assets/registry';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { flagstoneTexture } from '@/rendering/textures';
import { DECOR_BY_ID, type DecorDef } from '@/data/decor';
import { makeSign, makeStreetLamp, roundedBoxGeometry, surfaces } from './BuildingKit';
import { cloneOwned } from '@/util/three';

export interface BuiltDecor {
  group: Group;
  def: DecorDef;
  /** Non-null for pieces that light up; the caller drives its intensity. */
  light: PointLight | null;
  /** The emissive glass, so a lamp's globe brightens with its light. */
  glass: MeshStandardMaterial | null;
}

/**
 * Models for the outdoor decoration catalogue.
 *
 * Built from the same kit helpers the town itself is built from — the bench is
 * the square's bench, the lamp is the square's lamp — so a garden the player
 * lays out belongs to the same island rather than looking like a mod of it.
 *
 * With one rule the rest of the world does not need: every piece owns its
 * geometry and its materials outright. Decorations are the only things in the
 * game that are built and destroyed one at a time while it runs, and taking one
 * up calls `disposeObject` on it — which would otherwise free the shared kit
 * geometry and the cached kit material that every bush and fence on the island
 * is also drawn from. So kit geometry goes through `cloneOwned` — a plain
 * `clone()` inherits the registry's shared marker and would never be freed at
 * all — and kit materials are built rather than fetched from the cache.
 */
export function makeDecor(defId: string, tint?: string): BuiltDecor | null {
  const def = DECOR_BY_ID.get(defId);
  if (!def) return null;

  const group = new Group();
  group.name = `Decor_${defId}`;
  let light: PointLight | null = null;
  let glass: MeshStandardMaterial | null = null;

  switch (def.kind) {
    case 'flower':
      buildFlowerBed(group, tint ?? def.tints?.[0] ?? PALETTE.flowers[0]);
      break;
    case 'bush':
      buildShrub(group, tint ?? def.tints?.[0] ?? PALETTE.foliage.canopyMid);
      break;
    case 'fence':
      buildFencePanel(group);
      break;
    case 'bench':
      buildBench(group);
      break;
    case 'lamp': {
      const lamp = makeStreetLamp({ height: 2.8, glassColor: def.light?.color });
      group.add(lamp.group);
      light = lamp.light;
      glass = lamp.glass;
      break;
    }
    case 'sign':
      group.add(makeSign({ text: 'WELCOME', width: 1.5, height: 0.5 }));
      break;
    case 'path':
      buildSteppingStones(group);
      break;
  }

  group.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = def.kind !== 'path';
    mesh.receiveShadow = true;
  });

  return { group, def, light, glass };
}

/** A tilled bed with a dozen blooms standing in it, in the chosen colourway. */
function buildFlowerBed(group: Group, tint: string): void {
  const bed = new Mesh(
    roundedBoxGeometry(1.6, 0.24, 1.2, 0.28),
    createStylizedMaterial({ color: PALETTE.dirt.tilled, roughness: 0.97 }),
  );
  bed.position.y = 0.1;
  group.add(bed);

  const stem = createStylizedMaterial({ color: '#5f8b4a', roughness: 0.95, wind: 'foliage', windScale: 1.2 });
  const bloom = createStylizedMaterial({ color: tint, roughness: 0.85, wind: 'foliage', windScale: 1.6 });
  for (let i = 0; i < 12; i++) {
    const bx = -0.6 + (i % 6) * 0.24;
    const bz = -0.2 + Math.floor(i / 6) * 0.4;
    const stalk = new Mesh(new CylinderGeometry(0.018, 0.024, 0.34, 5), stem);
    stalk.position.set(bx, 0.37, bz);
    group.add(stalk);
    const head = new Mesh(new SphereGeometry(0.075, 7, 6), bloom);
    head.position.set(bx, 0.56, bz);
    head.scale.y = 0.75;
    group.add(head);
  }
}

/** A clipped round shrub — the kit's bush where one is loaded, a sphere otherwise. */
function buildShrub(group: Group, tint: string): void {
  const material = createStylizedMaterial({
    color: tint,
    roughness: 0.95,
    flatShading: true,
    wind: 'foliage',
    windScale: 0.9,
  });
  const kit = kitGeometry('bush.small');
  if (kit) {
    const bush = new Mesh(cloneOwned(kit), material);
    bush.scale.setScalar(1.15);
    group.add(bush);
    return;
  }
  const bush = new Mesh(new SphereGeometry(0.6, 9, 7), material);
  bush.position.y = 0.42;
  bush.scale.set(1.15, 0.85, 1.15);
  group.add(bush);
}

/**
 * One panel of picket fence, running along its own local Z so the placement
 * system's rotation turns it along the run rather than across it.
 */
function buildFencePanel(group: Group): void {
  const kit = kitGeometry('yard.fence');
  if (kit) {
    // The town kit's fence runs along its own local Z, which is the axis the
    // placement system rotates, so it needs no re-aiming here. The material is
    // built rather than taken from `kitMaterial`, whose cache hands the same
    // instance to every fence on the island.
    const material = createStylizedMaterial({
      vertexColors: true,
      color: '#f0e4d0',
      roughness: 0.92,
    });
    group.add(new Mesh(cloneOwned(kit), material));
    return;
  }
  const wood = createStylizedMaterial({ color: PALETTE.wood.plankDark, roughness: 0.94 });
  for (const dz of [-1.0, 1.0]) {
    const post = new Mesh(new BoxGeometry(0.11, 1.05, 0.11), wood);
    post.position.set(0, 0.52, dz);
    group.add(post);
  }
  for (const y of [0.42, 0.78]) {
    const rail = new Mesh(new BoxGeometry(0.06, 0.09, 2.0), wood);
    rail.position.set(0, y, 0);
    group.add(rail);
  }
  for (let i = 0; i < 5; i++) {
    const picket = new Mesh(new BoxGeometry(0.08, 0.9, 0.14), wood);
    picket.position.set(0, 0.46, -0.8 + i * 0.4);
    group.add(picket);
  }
}

/** The square's bench, at the square's proportions. */
function buildBench(group: Group): void {
  const wood = surfaces.plank(PALETTE.wood.plank, 1.2);
  const iron = createStylizedMaterial({ color: '#48524f', roughness: 0.55, metalness: 0.35 });

  const seat = new Mesh(roundedBoxGeometry(1.8, 0.13, 0.58, 0.07), wood);
  seat.position.y = 0.5;
  group.add(seat);

  const back = new Mesh(roundedBoxGeometry(1.8, 0.46, 0.11, 0.06), wood);
  back.position.set(0, 0.87, -0.24);
  back.rotation.x = -0.14;
  group.add(back);

  for (const dx of [-0.72, 0.72]) {
    const leg = new Mesh(new BoxGeometry(0.1, 0.5, 0.46), iron);
    leg.position.set(dx, 0.25, 0);
    group.add(leg);
  }
}

/** Three offset flagstones, so a run of these reads as a wandering path. */
function buildSteppingStones(group: Group): void {
  const stone = createStylizedMaterial({ color: '#b4ada0', roughness: 0.95, map: flagstoneTexture() });
  // Three slabs, offset, so a run of pieces reads as a wandering path rather
  // than a tiled floor.
  const slabs = [
    { x: -0.52, z: -0.3, r: 0.3, s: 0.92 },
    { x: 0.06, z: 0.12, r: -0.16, s: 1.05 },
    { x: 0.58, z: -0.22, r: 0.42, s: 0.86 },
  ];
  for (const slab of slabs) {
    const mesh = new Mesh(roundedBoxGeometry(0.68, 0.09, 0.6, 0.16), stone);
    mesh.position.set(slab.x, 0.04, slab.z);
    mesh.rotation.y = slab.r;
    mesh.scale.setScalar(slab.s);
    group.add(mesh);
  }
}
