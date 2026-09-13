import { Color, Group, InstancedMesh, Object3D, SphereGeometry, Vector3 } from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { Rng } from '@/util/rng';
import { SEA_LEVEL, waterDepth } from '@/world/heightfield';

interface Swimmer {
  x: number;
  z: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  wobble: number;
  /** Set while this fish has been recruited by a cast lure. */
  lured: Vector3 | null;
  luredTimer: number;
}

const COUNT = 46;

/**
 * The fish you can see in the water before you ever cast.
 *
 * Silhouettes rather than detailed models: a tapered body plus a tail, drawn as
 * two instanced meshes, drifting along the shelf. They matter because they tell
 * the player where fishing is worth trying.
 */
export class FishSchools {
  readonly group = new Group();
  private bodies: InstancedMesh;
  private tails: InstancedMesh;
  private swimmers: Swimmer[] = [];
  private dummy = new Object3D();

  constructor() {
    this.group.name = 'FishSchools';
    const rng = new Rng(5150);

    const material = createStylizedMaterial({
      color: '#1f4a5e',
      roughness: 0.6,
      transparent: true,
      opacity: 0.62,
    });

    const bodyGeometry = new SphereGeometry(0.5, 10, 7);
    bodyGeometry.scale(0.45, 0.32, 1);
    const tailGeometry = new SphereGeometry(0.32, 6, 5);
    tailGeometry.scale(0.08, 0.5, 0.55);

    this.bodies = new InstancedMesh(bodyGeometry, material, COUNT);
    this.tails = new InstancedMesh(tailGeometry, material, COUNT);
    this.bodies.frustumCulled = false;
    this.tails.frustumCulled = false;
    this.group.add(this.bodies, this.tails);

    const tint = new Color();
    let placed = 0;
    let attempts = 0;
    while (placed < COUNT && attempts < 4000) {
      attempts++;
      const x = rng.spread(105);
      const z = rng.spread(105);
      const depth = waterDepth(x, z);
      // Keep them on the shelf: deep enough to hide, shallow enough to see.
      if (depth < 0.9 || depth > 7) continue;
      this.swimmers.push({
        x, z,
        y: SEA_LEVEL - Math.min(depth * 0.55, 1.7),
        angle: rng.range(0, Math.PI * 2),
        speed: rng.range(0.55, 1.5),
        size: rng.range(0.55, 1.9),
        wobble: rng.range(0, 6.28),
        lured: null,
        luredTimer: 0,
      });
      tint.setHSL(0.52 + rng.range(-0.05, 0.06), 0.42, 0.2 + rng.range(0, 0.14));
      this.bodies.setColorAt(placed, tint);
      this.tails.setColorAt(placed, tint);
      placed++;
    }
    this.bodies.count = placed;
    this.tails.count = placed;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
  }

  /** Sends the nearest few fish to investigate a lure. Returns the closest one. */
  attractTo(point: Vector3, radius = 9): Vector3 | null {
    let nearest: Swimmer | null = null;
    let nearestDist = radius * radius;
    for (const fish of this.swimmers) {
      const d = (fish.x - point.x) ** 2 + (fish.z - point.z) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        nearest = fish;
      }
    }
    if (!nearest) return null;
    nearest.lured = point.clone();
    nearest.luredTimer = 14;
    return new Vector3(nearest.x, nearest.y, nearest.z);
  }

  releaseLure(): void {
    for (const fish of this.swimmers) {
      fish.lured = null;
      fish.luredTimer = 0;
    }
  }

  /** Position of the fish currently closest to the lure, for the bite tell. */
  luredPosition(): Vector3 | null {
    const fish = this.swimmers.find((f) => f.lured);
    return fish ? new Vector3(fish.x, fish.y, fish.z) : null;
  }

  update(dt: number, time: number, cameraX: number, cameraZ: number): void {
    for (let i = 0; i < this.swimmers.length; i++) {
      const fish = this.swimmers[i];

      if (fish.lured) {
        fish.luredTimer -= dt;
        if (fish.luredTimer <= 0) {
          fish.lured = null;
        } else {
          // Circle in toward the lure rather than beelining, so the approach
          // reads as curiosity.
          const dx = fish.lured.x - fish.x;
          const dz = fish.lured.z - fish.z;
          const distance = Math.hypot(dx, dz);
          const desired = Math.atan2(dx, dz) + (distance > 2.2 ? 0 : 0.9);
          let delta = desired - fish.angle;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          fish.angle += delta * Math.min(1, dt * 2.6);
        }
      } else {
        fish.angle += Math.sin(time * 0.5 + fish.wobble) * dt * 0.6;
      }

      const speed = fish.speed * (fish.lured ? 1.7 : 1);
      let nx = fish.x + Math.sin(fish.angle) * speed * dt;
      let nz = fish.z + Math.cos(fish.angle) * speed * dt;

      // Turn away from the shore rather than beaching.
      const depth = waterDepth(nx, nz);
      if (depth < 0.7 || Math.hypot(nx, nz) > 150) {
        fish.angle += Math.PI * 0.6;
        nx = fish.x;
        nz = fish.z;
      }
      fish.x = nx;
      fish.z = nz;
      fish.y = SEA_LEVEL - Math.min(Math.max(depth, 0.6) * 0.5, 1.7) + Math.sin(time * 1.6 + fish.wobble) * 0.08;

      // Cull far fish rather than paying for their transforms every frame.
      const distanceSq = (fish.x - cameraX) ** 2 + (fish.z - cameraZ) ** 2;
      if (distanceSq > 90 * 90) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.bodies.setMatrixAt(i, this.dummy.matrix);
        this.tails.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const tailSwish = Math.sin(time * 7 * fish.speed + fish.wobble) * 0.35;

      this.dummy.position.set(fish.x, fish.y, fish.z);
      this.dummy.rotation.set(0, fish.angle, 0);
      this.dummy.scale.setScalar(fish.size);
      this.dummy.updateMatrix();
      this.bodies.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(
        fish.x - Math.sin(fish.angle) * 0.5 * fish.size,
        fish.y,
        fish.z - Math.cos(fish.angle) * 0.5 * fish.size,
      );
      this.dummy.rotation.set(0, fish.angle + tailSwish, 0);
      this.dummy.updateMatrix();
      this.tails.setMatrixAt(i, this.dummy.matrix);
    }

    this.bodies.instanceMatrix.needsUpdate = true;
    this.tails.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.bodies.dispose();
    this.tails.dispose();
  }
}
