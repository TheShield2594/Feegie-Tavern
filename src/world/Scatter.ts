import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  DoubleSide,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { mergeGeometries } from '@/util/three';
import { clamp01 } from '@/util/math';
import { ISLAND_HALF, PATHS, SEA_LEVEL, distanceToCreek, sampleSurface } from './heightfield';
import type { TreeRecord } from './Foliage';

/**
 * Ground-level set dressing: mushrooms under the trees, pebbles along the
 * paths and the tideline, clover in the meadows, reeds by the creek, and a
 * carpet of fallen leaves in autumn.
 *
 * Every family is one instanced draw. Placement is rule-driven rather than
 * uniform — mushrooms want shade, pebbles want an edge, reeds want a bank —
 * which is what keeps it from reading as random confetti.
 */
export class Scatter {
  readonly group = new Group();
  private leaves: InstancedMesh | null = null;
  private dummy = new Object3D();

  /** Places every family once; `density` scales the counts with the quality tier. */
  constructor(trees: readonly TreeRecord[], density = 1) {
    this.group.name = 'Scatter';
    const rng = new Rng(777);
    this.buildMushrooms(rng, trees, density);
    this.buildPebbles(rng, density);
    this.buildClover(rng, density);
    this.buildReeds(rng, density);
    this.buildLeaves(rng, trees, density);
  }

  /** Signed distance to the nearest path edge; negative inside a path. */
  private nearPath(x: number, z: number): number {
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

  /** Mushrooms cluster in the shade of broadleaf and pine trunks. */
  private buildMushrooms(rng: Rng, trees: readonly TreeRecord[], density: number): void {
    const stem = new CylinderGeometry(0.035, 0.05, 0.16, 6);
    stem.translate(0, 0.08, 0);
    const cap = new SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.7, 1);
    cap.translate(0, 0.15, 0);
    const geometry = mergeGeometries([stem, cap]);
    const material = createStylizedMaterial({ color: '#ffffff', roughness: 0.85 });
    const count = Math.round(70 * density);
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = 'Mushrooms';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const shade = trees.filter((t) => t.kind === 'broadleaf' || t.kind === 'pine');
    const color = new Color();
    const capColors = ['#d9705f', '#e8b56a', '#f1e4cf', '#b8845c'];
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 12 && shade.length > 0) {
      attempts++;
      const tree = rng.pick(shade);
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1.2, 2.8);
      const x = tree.x + Math.cos(a) * r;
      const z = tree.z + Math.sin(a) * r;
      const sample = sampleSurface(x, z);
      if (sample.surface !== 'grass' || sample.slope > 0.45) continue;
      const s = rng.range(0.7, 1.5);
      this.dummy.position.set(x, sample.height, z);
      this.dummy.rotation.set(rng.spread(0.15), rng.range(0, 6.28), rng.spread(0.15));
      this.dummy.scale.set(s, s * rng.range(0.85, 1.3), s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      mesh.setColorAt(placed, color.set(rng.pick(capColors)));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Pebbles gather at path edges, the tideline and the creek banks. */
  private buildPebbles(rng: Rng, density: number): void {
    const geometry = new IcosahedronGeometry(0.12, 0);
    geometry.scale(1.2, 0.6, 1);
    const material = createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.95, flatShading: true });
    const count = Math.round(260 * density);
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = 'Pebbles';
    mesh.receiveShadow = true;
    const color = new Color();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 20) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 8);
      const z = rng.spread(ISLAND_HALF - 8);
      const sample = sampleSurface(x, z);
      if (sample.height < SEA_LEVEL + 0.1 || sample.slope > 0.5) continue;
      if (sample.surface === 'plaza' || sample.surface === 'wood' || sample.surface === 'water') continue;
      // Pebbles gather where something has worn the ground: path edges, the
      // tideline, the creek banks. Open meadow gets almost none.
      const edge = this.nearPath(x, z);
      const shore = sample.height < 1.6;
      const bank = distanceToCreek(x, z) < 4;
      const onPath = sample.surface === 'path' || sample.surface === 'dirt';
      const pathEdge = edge > -0.4 && edge < 1.4;
      if (!(shore || bank || pathEdge || (onPath && rng.chance(0.3)))) {
        if (!rng.chance(0.06)) continue;
      }
      const s = rng.range(0.5, 1.4);
      this.dummy.position.set(x, sample.height + 0.02, z);
      this.dummy.rotation.set(rng.spread(0.3), rng.range(0, 6.28), rng.spread(0.3));
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      color.set(shore ? '#e0d2b4' : PALETTE.rock.light).lerp(new Color(PALETTE.rock.dark), rng.range(0, 0.45));
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Clover clumps break up open grass; they take the foliage wind. */
  private buildClover(rng: Rng, density: number): void {
    // Three rounded leaves on short stalks: reads as a weed clump at distance.
    const leaf = new SphereGeometry(0.09, 6, 4);
    leaf.scale(1, 0.35, 1);
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const g = leaf.clone();
      const a = (i / 3) * Math.PI * 2;
      g.translate(Math.cos(a) * 0.09, 0.12 + (i % 2) * 0.03, Math.sin(a) * 0.09);
      parts.push(g);
    }
    const geometry = mergeGeometries(parts);
    const material = createStylizedMaterial({ color: '#6fa262', roughness: 0.95, wind: 'foliage', windScale: 1.4 });
    const count = Math.round(360 * density);
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = 'Clover';
    mesh.receiveShadow = true;
    const color = new Color();
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 10) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 8);
      const z = rng.spread(ISLAND_HALF - 8);
      const sample = sampleSurface(x, z);
      if (sample.surface !== 'grass' || sample.height < 2 || sample.slope > 0.5) continue;
      const s = rng.range(0.8, 1.6);
      this.dummy.position.set(x, sample.height, z);
      this.dummy.rotation.set(0, rng.range(0, 6.28), 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      color.set('#5f9a52').lerp(new Color('#9cc97a'), rng.next());
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Reeds stand where the ground is wet: creek banks and the sea's edge. */
  private buildReeds(rng: Rng, density: number): void {
    const blade = new ConeGeometry(0.035, 1.1, 4);
    blade.translate(0, 0.55, 0);
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const g = blade.clone();
      const a = (i / 5) * Math.PI * 2;
      g.rotateZ(0.12);
      g.rotateY(a);
      g.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      parts.push(g);
    }
    const geometry = mergeGeometries(parts);
    const material = createStylizedMaterial({ color: '#7f9a55', roughness: 0.95, wind: 'foliage', windScale: 2.2 });
    const count = Math.round(110 * density);
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = 'Reeds';
    mesh.castShadow = true;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 8);
      const z = rng.spread(ISLAND_HALF - 8);
      const sample = sampleSurface(x, z);
      // Reeds want their feet wet: creek banks and the very edge of the sea.
      const bank = distanceToCreek(x, z) < 3.2 && sample.height > SEA_LEVEL - 0.2;
      const tide = sample.height > SEA_LEVEL - 0.25 && sample.height < 0.45;
      if (!bank && !(tide && rng.chance(0.35))) continue;
      if (sample.surface === 'path' || sample.surface === 'wood') continue;
      const s = rng.range(0.7, 1.3);
      this.dummy.position.set(x, sample.height - 0.05, z);
      this.dummy.rotation.set(0, rng.range(0, 6.28), 0);
      this.dummy.scale.set(s, s * rng.range(0.8, 1.4), s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Fallen leaves under broadleaf trees, hidden outside autumn. */
  private buildLeaves(rng: Rng, trees: readonly TreeRecord[], density: number): void {
    const geometry = new PlaneGeometry(0.22, 0.16);
    geometry.rotateX(-Math.PI / 2);
    const material = createStylizedMaterial({ color: '#ffffff', roughness: 0.95, side: DoubleSide });
    const broadleaf = trees.filter((t) => t.kind === 'broadleaf' || t.kind === 'fruit');
    const count = Math.round(Math.min(600, broadleaf.length * 5) * density);
    const mesh = new InstancedMesh(geometry, material, Math.max(1, count));
    mesh.name = 'FallenLeaves';
    mesh.receiveShadow = true;
    const color = new Color();
    const palette = ['#d98a3c', '#c9663f', '#e8b04a', '#a8592f'];
    let placed = 0;
    for (let i = 0; i < count && broadleaf.length > 0; i++) {
      const tree = rng.pick(broadleaf);
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 3.4 * tree.scale;
      const x = tree.x + Math.cos(a) * r;
      const z = tree.z + Math.sin(a) * r;
      const sample = sampleSurface(x, z);
      if (sample.surface === 'water' || sample.slope > 0.5) continue;
      this.dummy.position.set(x, sample.height + 0.015, z);
      this.dummy.rotation.set(0, rng.range(0, 6.28), 0);
      this.dummy.scale.setScalar(rng.range(0.8, 1.3));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(placed, this.dummy.matrix);
      mesh.setColorAt(placed, color.set(rng.pick(palette)));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = false;
    this.leaves = mesh;
    this.group.add(mesh);
  }

  /** Autumn shows the leaf litter; every other season hides it. */
  applySeason(season: string): void {
    if (this.leaves) this.leaves.visible = season === 'Autumn';
  }

  /** Releases every instanced family, geometry and material included. */
  dispose(): void {
    // Every family owns its geometry and material outright, so they go too;
    // `InstancedMesh.dispose` only releases the instance buffers.
    this.group.traverse((child) => {
      const mesh = child as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      mesh.dispose();
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const m of material) m.dispose();
      else material.dispose();
    });
  }
}

