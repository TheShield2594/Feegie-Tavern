import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE, SEASON_TINT } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { clamp01, lerp, smoothstep } from '@/util/math';
import { ISLAND_HALF, PATHS, sampleSurface } from './heightfield';

export type TreeKind = 'broadleaf' | 'pine' | 'palm' | 'fruit';

export interface TreeRecord {
  id: string;
  index: number;
  kind: TreeKind;
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
  hasFruit: boolean;
  /** In-game day the tree was last shaken or chopped. */
  harvestedOnDay: number;
  woodOnDay: number;
  /** Runtime shake animation, seconds remaining. */
  shakeTimer: number;
  shakePhase: number;
}

interface ScatterRule {
  count: number;
  /** Only place where the ground is at least this high (keeps trees off the beach). */
  minHeight: number;
  maxHeight: number;
  maxSlope: number;
  /** Keep this far from paths and building pads. */
  clearance: number;
}

const KEEP_OUT: { x: number; z: number; r: number }[] = [
  { x: 0, z: 0, r: 19 },       // town square
  { x: -25, z: -20, r: 11 },   // player cottage
  { x: 22, z: -13, r: 11 },    // store
  { x: -6, z: -40, r: 16 },    // museum
  { x: 30, z: -34, r: 10 },    // Pip
  { x: -46, z: -8, r: 10 },    // Mallow
  { x: 44, z: 6, r: 10 },      // Bruno
  { x: 0, z: -54, r: 13 },     // town hall
  { x: 42, z: -46, r: 13 },    // lighthouse
  { x: -34, z: 20, r: 13 },    // farm
  { x: 12, z: 52, r: 11 },     // harbour
];

function distanceToPaths(x: number, z: number): number {
  let best = Infinity;
  for (const p of PATHS) {
    const dx = p.bx - p.ax;
    const dz = p.bz - p.az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq < 1e-6 ? 0 : clamp01(((x - p.ax) * dx + (z - p.az) * dz) / lenSq);
    best = Math.min(best, Math.hypot(x - (p.ax + dx * t), z - (p.az + dz * t)) - p.width * 0.5);
  }
  return best;
}

function blockedByStructure(x: number, z: number, clearance: number): boolean {
  for (const k of KEEP_OUT) {
    if (Math.hypot(x - k.x, z - k.z) < k.r + clearance) return true;
  }
  return false;
}

/** Adds gentle per-vertex noise so a shared blob geometry still looks hand-made. */
function roughen(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  const rng = new Rng(seed);
  for (let i = 0; i < position.count; i++) {
    const scale = 1 + (rng.next() - 0.5) * amount;
    position.setXYZ(i, position.getX(i) * scale, position.getY(i) * scale, position.getZ(i) * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * All the island's plant life.
 *
 * Everything is instanced: one draw call per trunk type and per canopy blob
 * layer, one for bushes, one for flowers, and one per grass chunk. Trees remain
 * individually addressable — shaking one rewrites just that instance's matrix —
 * so instancing costs nothing in gameplay flexibility.
 */
export class Foliage {
  readonly group = new Group();

  readonly trees: TreeRecord[] = [];
  private trunkMeshes = new Map<TreeKind, InstancedMesh>();
  private canopyLayers: InstancedMesh[] = [];
  private canopyOffsets: { dx: number; dy: number; dz: number; scale: number }[] = [];
  private fruitMesh: InstancedMesh | null = null;
  private fruitOwners: number[] = [];

  private bushes: InstancedMesh | null = null;
  private flowers: InstancedMesh | null = null;
  private flowerCenters: InstancedMesh | null = null;

  /** Grass is chunked so distant chunks can be hidden wholesale. */
  private grassChunks: { mesh: InstancedMesh; cx: number; cz: number }[] = [];
  private grassDistance = 58;

  private dummy = new Object3D();
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  private euler = new Euler();
  private scaleVec = new Vector3();
  private positionVec = new Vector3();

  private canopyMaterial = createStylizedMaterial({
    color: PALETTE.foliage.canopyMid,
    roughness: 0.95,
    wind: 'canopy',
    windScale: 1,
    flatShading: true,
    wetResponse: 0.5,
  });

  private pineMaterial = createStylizedMaterial({
    color: PALETTE.foliage.pine,
    roughness: 0.95,
    wind: 'canopy',
    windScale: 0.55,
    flatShading: true,
  });

  private barkMaterial = createStylizedMaterial({
    color: PALETTE.foliage.bark,
    roughness: 0.98,
    wind: 'canopy',
    windScale: 0.28,
    flatShading: true,
  });

  private bushMaterial = createStylizedMaterial({
    color: PALETTE.foliage.canopyMid,
    roughness: 0.95,
    wind: 'foliage',
    windScale: 0.8,
    flatShading: true,
  });

  private grassMaterial = createStylizedMaterial({
    color: PALETTE.grass.highlight,
    roughness: 1,
    wind: 'grass',
    windScale: 1.5,
    side: DoubleSide,
    transparent: true,
    alphaTest: 0.32,
  });

  private flowerMaterial = createStylizedMaterial({
    color: '#ffffff',
    roughness: 0.85,
    wind: 'foliage',
    windScale: 1.9,
    side: DoubleSide,
  });

  private fruitMaterial = createStylizedMaterial({
    color: '#e8a33c',
    roughness: 0.6,
  });

  constructor(density = 1) {
    this.group.name = 'Foliage';
    const rng = new Rng(90210);

    this.buildTrees(rng, density);
    this.buildBushes(rng, density);
    this.buildFlowers(rng, density);
    this.buildGrass(rng, density);
  }

  // --- Trees ---------------------------------------------------------------

  private buildTrees(rng: Rng, density: number): void {
    const plans: { kind: TreeKind; rule: ScatterRule }[] = [
      { kind: 'broadleaf', rule: { count: Math.round(190 * density), minHeight: 2.2, maxHeight: 16, maxSlope: 0.45, clearance: 2 } },
      { kind: 'pine', rule: { count: Math.round(110 * density), minHeight: 6.5, maxHeight: 26, maxSlope: 0.58, clearance: 2 } },
      { kind: 'palm', rule: { count: Math.round(34 * density), minHeight: 0.9, maxHeight: 3.0, maxSlope: 0.34, clearance: 3 } },
      { kind: 'fruit', rule: { count: Math.round(26 * density), minHeight: 2.0, maxHeight: 11, maxSlope: 0.3, clearance: 4 } },
    ];

    const records: TreeRecord[] = [];
    for (const plan of plans) {
      let placed = 0;
      let attempts = 0;
      while (placed < plan.rule.count && attempts < plan.rule.count * 40) {
        attempts++;
        const x = rng.spread(ISLAND_HALF - 8);
        const z = rng.spread(ISLAND_HALF - 8);
        const sample = sampleSurface(x, z);
        if (sample.height < plan.rule.minHeight || sample.height > plan.rule.maxHeight) continue;
        if (sample.slope > plan.rule.maxSlope) continue;
        if (sample.surface === 'path' || sample.surface === 'plaza' || sample.surface === 'water') continue;
        if (distanceToPaths(x, z) < plan.rule.clearance) continue;
        if (blockedByStructure(x, z, plan.rule.clearance)) continue;
        // Fruit trees belong in the orchard and around the farm.
        if (plan.kind === 'fruit') {
          const nearOrchard = Math.hypot(x - 50, z - 22) < 22 || Math.hypot(x + 34, z - 20) < 18;
          if (!nearOrchard) continue;
        }
        if (plan.kind === 'palm') {
          // Palms belong on the shoreline, not scattered across the meadows.
          const coastal = [[9, 0], [-9, 0], [0, 9], [0, -9]].some(
            ([dx, dz]) => sampleSurface(x + dx, z + dz).height < 0.2,
          );
          if (!coastal) continue;
        }

        records.push({
          id: `tree_${records.length}`,
          index: 0,
          kind: plan.kind,
          x,
          z,
          y: sample.height,
          scale: rng.range(0.68, 1.02) * (plan.kind === 'palm' ? 1.15 : 1),
          rotation: rng.range(0, Math.PI * 2),
          hasFruit: plan.kind === 'fruit',
          harvestedOnDay: -99,
          woodOnDay: -99,
          shakeTimer: 0,
          shakePhase: 0,
        });
        placed++;
      }
    }

    this.trees.push(...records);

    // --- Trunks -----------------------------------------------------------
    const trunkGeometries: Record<TreeKind, BufferGeometry> = {
      broadleaf: roughen(new CylinderGeometry(0.26, 0.42, 3.2, 7, 1), 0.1, 3),
      pine: roughen(new CylinderGeometry(0.2, 0.4, 3.6, 6, 1), 0.08, 5),
      palm: roughen(new CylinderGeometry(0.2, 0.32, 5.4, 6, 3), 0.12, 7),
      fruit: roughen(new CylinderGeometry(0.24, 0.38, 2.6, 7, 1), 0.1, 9),
    };
    for (const geometry of Object.values(trunkGeometries)) geometry.translate(0, 0, 0);

    for (const kind of ['broadleaf', 'pine', 'palm', 'fruit'] as TreeKind[]) {
      const subset = records.filter((r) => r.kind === kind);
      if (subset.length === 0) continue;
      const geometry = trunkGeometries[kind];
      // Anchor the trunk's base at the origin so instances sit on the ground.
      const height = kind === 'palm' ? 5.4 : kind === 'pine' ? 3.6 : kind === 'fruit' ? 2.6 : 3.2;
      geometry.translate(0, height / 2, 0);

      const mesh = new InstancedMesh(geometry, this.barkMaterial, subset.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Trunks_${kind}`;
      subset.forEach((record, i) => {
        record.index = i;
        this.dummy.position.set(record.x, record.y, record.z);
        this.dummy.rotation.set(0, record.rotation, 0);
        this.dummy.scale.setScalar(record.scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.trunkMeshes.set(kind, mesh);
      this.group.add(mesh);
    }

    // --- Canopies ----------------------------------------------------------
    // Three offset blobs per tree gives a canopy real volume from every angle,
    // at the cost of three instanced draws for the entire island.
    this.canopyOffsets = [
      { dx: -0.7, dy: 3.3, dz: 0.3, scale: 1.32 },
      { dx: 0.75, dy: 3.6, dz: -0.26, scale: 1.2 },
      { dx: 0.04, dy: 4.35, dz: 0.12, scale: 1.06 },
    ];

    const blobGeometry = roughen(new IcosahedronGeometry(1, 1), 0.13, 21);
    const pineGeometry = roughen(new ConeGeometry(1, 2.4, 7, 2), 0.14, 23);
    // A frond is a long tapered blade rather than a disc, so palms read as
    // palms from every angle.
    const palmFrond = roughen(new SphereGeometry(1, 8, 6), 0.18, 27);
    palmFrond.scale(0.34, 0.16, 1.7);
    palmFrond.translate(0, 0, 1.5);

    for (let layer = 0; layer < this.canopyOffsets.length; layer++) {
      const mesh = new InstancedMesh(blobGeometry, this.canopyMaterial, records.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Canopy_${layer}`;
      mesh.userData.noFade = true;
      this.canopyLayers.push(mesh);
      this.group.add(mesh);
    }

    // Pines and palms replace the blob canopy with their own silhouette.
    const pineRecords = records.filter((r) => r.kind === 'pine');
    if (pineRecords.length > 0) {
      const pines = new InstancedMesh(pineGeometry, this.pineMaterial, pineRecords.length * 3);
      pines.castShadow = true;
      pines.receiveShadow = true;
      pines.name = 'PineCanopy';
      pineRecords.forEach((record, i) => {
        for (let tier = 0; tier < 3; tier++) {
          const t = tier / 2;
          this.dummy.position.set(record.x, record.y + (2.6 + tier * 1.5) * record.scale, record.z);
          this.dummy.rotation.set(0, record.rotation + tier * 0.5, 0);
          this.dummy.scale.setScalar(record.scale * lerp(1.5, 0.7, t));
          this.dummy.updateMatrix();
          pines.setMatrixAt(i * 3 + tier, this.dummy.matrix);
        }
      });
      pines.instanceMatrix.needsUpdate = true;
      this.group.add(pines);
    }

    const palmRecords = records.filter((r) => r.kind === 'palm');
    if (palmRecords.length > 0) {
      const palms = new InstancedMesh(palmFrond, this.canopyMaterial, palmRecords.length * 5);
      palms.castShadow = true;
      palms.name = 'PalmCanopy';
      palmRecords.forEach((record, i) => {
        for (let f = 0; f < 5; f++) {
          const angle = record.rotation + (f / 5) * Math.PI * 2;
          this.dummy.position.set(record.x, record.y + 5.3 * record.scale, record.z);
          // Fronds fan out and droop, alternating slightly for variety.
          this.dummy.rotation.set(0.36 + (f % 2) * 0.16, angle, 0);
          this.dummy.scale.setScalar(record.scale * 1.35);
          this.dummy.updateMatrix();
          palms.setMatrixAt(i * 5 + f, this.dummy.matrix);
        }
      });
      palms.instanceMatrix.needsUpdate = true;
      this.group.add(palms);
    }

    // Blob canopies for broadleaf and fruit trees.
    const blobRecords = records.filter((r) => r.kind === 'broadleaf' || r.kind === 'fruit');
    const canopyColor = new Color();
    for (let layer = 0; layer < this.canopyLayers.length; layer++) {
      const mesh = this.canopyLayers[layer];
      mesh.count = blobRecords.length;
      const offset = this.canopyOffsets[layer];
      blobRecords.forEach((record, i) => {
        this.writeCanopyMatrix(record, offset, 0);
        mesh.setMatrixAt(i, this.matrix);
        // Vary each blob so the forest is not one flat green.
        const mix = ((i * 7 + layer * 3) % 10) / 10;
        canopyColor.set(PALETTE.foliage.canopyDark).lerp(new Color(PALETTE.foliage.canopyLight), mix * 0.55 + layer * 0.14);
        mesh.setColorAt(i, canopyColor);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.records = blobRecords;
    }

    // --- Fruit -------------------------------------------------------------
    const fruitRecords = records.filter((r) => r.kind === 'fruit');
    if (fruitRecords.length > 0) {
      const fruitGeometry = new IcosahedronGeometry(0.22, 0);
      const perTree = 3;
      this.fruitMesh = new InstancedMesh(fruitGeometry, this.fruitMaterial, fruitRecords.length * perTree);
      this.fruitMesh.castShadow = true;
      this.fruitMesh.name = 'Fruit';
      this.fruitOwners = [];
      fruitRecords.forEach((record) => {
        for (let f = 0; f < perTree; f++) {
          this.fruitOwners.push(this.trees.indexOf(record));
        }
      });
      this.refreshFruit(1);
      this.group.add(this.fruitMesh);
    }
  }

  private writeCanopyMatrix(
    record: TreeRecord,
    offset: { dx: number; dy: number; dz: number; scale: number },
    shake: number,
  ): void {
    const s = record.scale;
    // Shake rocks the canopy around the trunk base and squashes it slightly.
    const sway = Math.sin(shake * 34 + record.shakePhase) * shake * 0.22;
    this.euler.set(sway * 0.6, record.rotation, sway);
    this.quaternion.setFromEuler(this.euler);
    this.positionVec.set(
      record.x + offset.dx * s + sway * 0.9,
      record.y + offset.dy * s - shake * 0.14,
      record.z + offset.dz * s,
    );
    this.scaleVec.setScalar(offset.scale * s * (1 + shake * 0.06));
    this.matrix.compose(this.positionVec, this.quaternion, this.scaleVec);
  }

  /** Repopulates fruit for trees that have regrown since being shaken. */
  refreshFruit(day: number): void {
    if (!this.fruitMesh) return;
    const hidden = new Vector3(0, -1000, 0);
    for (let i = 0; i < this.fruitOwners.length; i++) {
      const record = this.trees[this.fruitOwners[i]];
      const slot = i % 3;
      // Fruit regrows three days after a shake.
      const ready = record.hasFruit && day - record.harvestedOnDay >= 3;
      if (!ready) {
        this.dummy.position.copy(hidden);
        this.dummy.scale.setScalar(0.001);
      } else {
        const angle = record.rotation + (slot / 3) * Math.PI * 2 + 0.4;
        this.dummy.position.set(
          record.x + Math.cos(angle) * 1.5 * record.scale,
          record.y + (3.4 + slot * 0.35) * record.scale,
          record.z + Math.sin(angle) * 1.5 * record.scale,
        );
        this.dummy.scale.setScalar(record.scale);
      }
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.fruitMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.fruitMesh.instanceMatrix.needsUpdate = true;
  }

  /** Triggers the shake animation on one tree. */
  shakeTree(record: TreeRecord): void {
    record.shakeTimer = 0.85;
    record.shakePhase = Math.random() * 6.28;
  }

  /** Nearest tree within `radius` of a point, or null. */
  treeNear(x: number, z: number, radius: number): TreeRecord | null {
    let best: TreeRecord | null = null;
    let bestDist = radius * radius;
    for (const tree of this.trees) {
      const d = (tree.x - x) ** 2 + (tree.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = tree;
      }
    }
    return best;
  }

  // --- Bushes, flowers, grass ---------------------------------------------

  private buildBushes(rng: Rng, density: number): void {
    const geometry = roughen(new IcosahedronGeometry(0.75, 1), 0.32, 33);
    const count = Math.round(240 * density);
    const placed: { x: number; y: number; z: number; s: number; r: number; tint: number }[] = [];

    let attempts = 0;
    while (placed.length < count && attempts < count * 30) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 6);
      const z = rng.spread(ISLAND_HALF - 6);
      const sample = sampleSurface(x, z);
      if (sample.height < 2.1 || sample.slope > 0.5) continue;
      if (sample.surface !== 'grass') continue;
      if (distanceToPaths(x, z) < 1.4) continue;
      if (blockedByStructure(x, z, 1)) continue;
      placed.push({ x, y: sample.height, z, s: rng.range(0.7, 1.5), r: rng.range(0, 6.28), tint: rng.next() });
    }

    const mesh = new InstancedMesh(geometry, this.bushMaterial, placed.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'Bushes';
    const color = new Color();
    placed.forEach((b, i) => {
      this.dummy.position.set(b.x, b.y + 0.42 * b.s, b.z);
      this.dummy.rotation.set(0, b.r, 0);
      this.dummy.scale.set(b.s * 1.15, b.s * 0.85, b.s * 1.15);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      color.set(PALETTE.foliage.canopyMid).lerp(new Color(PALETTE.foliage.canopyLight), b.tint * 0.7);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.bushes = mesh;
    this.group.add(mesh);
  }

  private buildFlowers(rng: Rng, density: number): void {
    // A five-petal rosette: cheap, reads clearly from the game camera.
    const petal = new SphereGeometry(0.5, 6, 4);
    petal.scale(1, 0.35, 1);
    const petals: BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const g = petal.clone();
      const a = (i / 5) * Math.PI * 2;
      g.translate(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      petals.push(g);
    }
    const merged = mergeSimple(petals);
    merged.scale(0.24, 0.24, 0.24);
    merged.translate(0, 0.26, 0);

    const count = Math.round(700 * density);
    const placed: { x: number; y: number; z: number; s: number; r: number; c: string }[] = [];
    let attempts = 0;
    while (placed.length < count && attempts < count * 20) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 6);
      const z = rng.spread(ISLAND_HALF - 6);
      const sample = sampleSurface(x, z);
      if (sample.height < 2.0 || sample.slope > 0.42) continue;
      if (sample.surface !== 'grass') continue;
      if (blockedByStructure(x, z, -6)) continue;
      placed.push({
        x, y: sample.height, z,
        s: rng.range(0.75, 1.35),
        r: rng.range(0, 6.28),
        c: rng.pick(PALETTE.flowers),
      });
    }

    const mesh = new InstancedMesh(merged, this.flowerMaterial, placed.length);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = 'Flowers';
    const color = new Color();
    placed.forEach((f, i) => {
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.rotation.set(0, f.r, 0);
      this.dummy.scale.setScalar(f.s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, color.set(f.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.flowers = mesh;
    this.group.add(mesh);

    // Yellow centres, so flowers read at distance.
    const centre = new SphereGeometry(0.062, 6, 4);
    centre.translate(0, 0.21, 0);
    const centres = new InstancedMesh(centre, createStylizedMaterial({ color: '#f2c94c', roughness: 0.7 }), placed.length);
    centres.name = 'FlowerCentres';
    placed.forEach((f, i) => {
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.rotation.set(0, f.r, 0);
      this.dummy.scale.setScalar(f.s);
      this.dummy.updateMatrix();
      centres.setMatrixAt(i, this.dummy.matrix);
    });
    centres.instanceMatrix.needsUpdate = true;
    this.flowerCenters = centres;
    this.group.add(centres);
  }

  private buildGrass(rng: Rng, density: number): void {
    // A tuft of three crossed blades. uv.y drives the wind stiffness.
    const blade = makeBladeGeometry();
    const tuft = mergeSimple([
      blade.clone().rotateY(0),
      blade.clone().rotateY(1.1).translate(0.06, 0, 0.04),
      blade.clone().rotateY(2.3).translate(-0.05, 0, -0.05),
    ]);

    const chunkSize = 20;
    const chunksPerSide = Math.ceil((ISLAND_HALF * 2) / chunkSize);
    const perChunk = Math.round(520 * density);

    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const originX = -ISLAND_HALF + cx * chunkSize;
        const originZ = -ISLAND_HALF + cz * chunkSize;
        const placed: { x: number; y: number; z: number; s: number; r: number; t: number }[] = [];

        for (let i = 0; i < perChunk; i++) {
          const x = originX + rng.next() * chunkSize;
          const z = originZ + rng.next() * chunkSize;
          const sample = sampleSurface(x, z);
          if (sample.height < 1.9 || sample.slope > 0.55) continue;
          if (sample.surface !== 'grass') continue;
          placed.push({ x, y: sample.height, z, s: rng.range(0.6, 1.15), r: rng.range(0, 6.28), t: rng.next() });
        }
        if (placed.length < 8) continue;

        const mesh = new InstancedMesh(tuft, this.grassMaterial, placed.length);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = `Grass_${cx}_${cz}`;
        const color = new Color();
        placed.forEach((g, i) => {
          this.dummy.position.set(g.x, g.y, g.z);
          this.dummy.rotation.set(0, g.r, 0);
          this.dummy.scale.set(g.s, g.s * rng.range(0.85, 1.3), g.s);
          this.dummy.updateMatrix();
          mesh.setMatrixAt(i, this.dummy.matrix);
          color.set(PALETTE.grass.shadow).lerp(new Color(PALETTE.grass.highlight), 0.35 + g.t * 0.65);
          mesh.setColorAt(i, color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.grassChunks.push({ mesh, cx: originX + chunkSize / 2, cz: originZ + chunkSize / 2 });
        this.group.add(mesh);
      }
    }
  }

  setGrassDistance(distance: number): void {
    this.grassDistance = distance;
  }

  /** Season retint of canopies and grass. */
  applySeason(season: string): void {
    const tint = SEASON_TINT[season] ?? SEASON_TINT.Spring;
    this.canopyMaterial.color.set(tint.canopy);
    this.grassMaterial.color.set(tint.grass);
    this.bushMaterial.color.set(new Color(tint.canopy).multiplyScalar(0.94));
    if (this.fruitMesh) this.fruitMesh.visible = season !== 'Winter';
  }

  /** Per-frame: tree shake animation and grass chunk culling. */
  update(dt: number, cameraX: number, cameraZ: number): void {
    const blobRecords = (this.canopyLayers[0]?.userData.records ?? []) as TreeRecord[];
    let dirty = false;
    for (let i = 0; i < blobRecords.length; i++) {
      const record = blobRecords[i];
      if (record.shakeTimer <= 0) continue;
      record.shakeTimer = Math.max(0, record.shakeTimer - dt);
      const shake = smoothstep(0, 0.85, record.shakeTimer) * (record.shakeTimer / 0.85);
      for (let layer = 0; layer < this.canopyLayers.length; layer++) {
        this.writeCanopyMatrix(record, this.canopyOffsets[layer], shake);
        this.canopyLayers[layer].setMatrixAt(i, this.matrix);
      }
      dirty = true;
    }
    if (dirty) {
      for (const mesh of this.canopyLayers) mesh.instanceMatrix.needsUpdate = true;
    }

    // Chunks are 20 m square, so allow for their half-diagonal before hiding
    // one; otherwise a chunk the player is standing at the edge of vanishes.
    const cull = this.grassDistance + 15;
    const cullSq = cull * cull;
    for (const chunk of this.grassChunks) {
      const d = (chunk.cx - cameraX) ** 2 + (chunk.cz - cameraZ) ** 2;
      chunk.mesh.visible = d < cullSq;
    }
  }

  /** Meshes the camera should fade when they block the player. */
  get occluders(): Object3D[] {
    return [...this.trunkMeshes.values()];
  }

  get stats(): { trees: number; grassChunks: number; bushes: number; flowers: number } {
    return {
      trees: this.trees.length,
      grassChunks: this.grassChunks.length,
      bushes: this.bushes?.count ?? 0,
      flowers: this.flowers?.count ?? 0,
    };
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as InstancedMesh;
      if (mesh.isInstancedMesh) mesh.dispose();
    });
    void this.flowerCenters;
  }
}

/** A single curved grass blade. `uv.y` runs 0 at the root to 1 at the tip. */
function makeBladeGeometry(): BufferGeometry {
  const segments = 4;
  const height = 0.5;
  const halfWidth = 0.06;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height;
    // Taper to a point and lean the blade over slightly.
    const w = halfWidth * (1 - t * 0.92);
    const lean = t * t * 0.12;
    positions.push(-w, y, lean, w, y, lean);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Minimal geometry merge for non-indexed/indexed position+uv+normal buffers.
 * Avoids pulling in BufferGeometryUtils for the handful of merges we need.
 */
function mergeSimple(geometries: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const geometry of geometries) {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else uvs.push(0, 0);
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    }
    offset += pos.count;
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  if (normals.length === positions.length) {
    merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  return merged;
}
