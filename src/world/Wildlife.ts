import {
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { Rng } from '@/util/rng';
import { clamp01, lerp, smoothstep } from '@/util/math';
import { LANDMARKS } from './heightfield';

interface Gull {
  centre: Vector3;
  radius: number;
  height: number;
  phase: number;
  speed: number;
  direction: 1 | -1;
}

const GULL_COUNT = 7;

/**
 * Ambient animals: gulls wheeling over the harbour and the lighthouse. Purely
 * local and purely cosmetic — nothing here is gameplay, and nothing here would
 * ever need to be synchronised.
 *
 * This used to fly a population of decorative butterflies over the meadows too.
 * They are gone: `src/gathering/Insects.ts` now flies real ones that can be
 * walked up to, startled and caught, and two visually identical populations
 * where only one of them answers the net is worse than either alone.
 *
 * One instanced mesh per wing, so the whole flock is two draw calls, and they
 * fade out by scaling to zero rather than toggling visibility, so a gull never
 * pops out of existence in front of the player.
 */
export class Wildlife {
  readonly group = new Group();

  private gulls: Gull[] = [];
  private gullWingL: InstancedMesh;
  private gullWingR: InstancedMesh;

  private dummy = new Object3D();
  private matrix = new Matrix4();
  private quat = new Quaternion();
  private scratch = new Vector3();
  private time = 0;
  private gullLevel = 0;

  /** Builds the flock and picks its roosts from the heightfield. */
  constructor() {
    this.group.name = 'Wildlife';
    const rng = new Rng(4242);

    // --- Gulls -----------------------------------------------------------
    const gullWing = new PlaneGeometry(0.9, 0.26);
    gullWing.translate(0.45, 0, 0);
    const gullMaterial = createStylizedMaterial({ color: '#f4f2ea', roughness: 0.85, side: DoubleSide });
    this.gullWingL = new InstancedMesh(gullWing, gullMaterial, GULL_COUNT);
    this.gullWingR = new InstancedMesh(gullWing, gullMaterial, GULL_COUNT);
    this.gullWingL.name = 'GullWingsL';
    this.gullWingR.name = 'GullWingsR';
    this.gullWingL.frustumCulled = false;
    this.gullWingR.frustumCulled = false;
    this.group.add(this.gullWingL, this.gullWingR);

    const roosts = [LANDMARKS['beach.pier'], LANDMARKS['lighthouse.point'], LANDMARKS['beach.dunes']];
    for (let i = 0; i < GULL_COUNT; i++) {
      const roost = roosts[i % roosts.length];
      this.gulls.push({
        centre: new Vector3(roost.x + rng.spread(6), 0, roost.z + rng.spread(6)),
        radius: rng.range(9, 18),
        height: rng.range(11, 19),
        phase: rng.range(0, Math.PI * 2),
        speed: rng.range(0.16, 0.26),
        direction: rng.chance(0.5) ? 1 : -1,
      });
    }
  }

  /**
   * @param daylight 0 at night, 1 in full day.
   * @param rain Precipitation, 0–1. Gulls thin out in it.
   */
  update(dt: number, daylight: number, rain: number, season: string, wind: number, cameraX: number, cameraZ: number): void {
    void season;
    void wind;
    this.time += dt;

    const gullTarget = smoothstep(0.1, 0.4, daylight) * (1 - clamp01(rain * 1.5) * 0.7);
    this.gullLevel = lerp(this.gullLevel, gullTarget, 1 - Math.exp(-dt * 0.6));

    this.updateGulls(dt, cameraX, cameraZ);
  }

  /** Moves each gull round its circuit with a slow glide-and-beat wing cycle. */
  private updateGulls(dt: number, cameraX: number, cameraZ: number): void {
    void dt;
    const level = this.gullLevel;
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i];
      const dx = g.centre.x - cameraX;
      const dz = g.centre.z - cameraZ;
      if (dx * dx + dz * dz > 110 * 110 || level < 0.01) {
        this.hide(this.gullWingL, i);
        this.hide(this.gullWingR, i);
        continue;
      }
      const t = this.time * g.speed * g.direction + g.phase;
      const x = g.centre.x + Math.cos(t) * g.radius;
      const z = g.centre.z + Math.sin(t) * g.radius;
      const y = g.height + Math.sin(this.time * 0.4 + g.phase) * 1.6;
      this.scratch.set(x, y, z);
      // Heading is the tangent of the circle.
      const heading = Math.atan2(-Math.sin(t) * g.direction, Math.cos(t) * g.direction);
      // Gulls glide: long slow beats with a held glide between them.
      const cycle = (this.time * 1.6 + g.phase) % 4;
      const beat = cycle < 1.4 ? Math.sin(cycle / 1.4 * Math.PI * 2) * 0.55 : 0.12;
      const s = level;
      this.writeWing(this.gullWingL, i, this.scratch, heading, beat, s, 1);
      this.writeWing(this.gullWingR, i, this.scratch, heading, -beat, s, -1);
    }
    this.gullWingL.instanceMatrix.needsUpdate = true;
    this.gullWingR.instanceMatrix.needsUpdate = true;
  }

  /** Writes one wing's instance matrix: faced along `heading`, hinged up by `flap`. */
  private writeWing(mesh: InstancedMesh, index: number, at: Vector3, heading: number, flap: number, scale: number, side: 1 | -1): void {
    this.dummy.position.copy(at);
    // Face the heading, lie flat, then hinge each wing up by the flap angle.
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.quat.setFromAxisAngle(new Vector3(0, 1, 0), heading);
    this.dummy.quaternion.premultiply(this.quat);
    this.quat.setFromAxisAngle(new Vector3(Math.sin(heading), 0, Math.cos(heading)), flap * side);
    this.dummy.quaternion.premultiply(this.quat);
    this.dummy.scale.set(scale * side, scale, scale);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  /** Collapses an instance to zero scale, which is cheaper than toggling counts. */
  private hide(mesh: InstancedMesh, index: number): void {
    this.matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(index, this.matrix);
  }

  /** Releases the wing meshes and the geometry and material the pair shares. */
  dispose(): void {
    // The pair of wings shares one geometry and one material, so those are
    // released once rather than once per wing.
    for (const mesh of [this.gullWingL, this.gullWingR]) mesh.dispose();
    this.gullWingL.geometry.dispose();
    (this.gullWingL.material as { dispose(): void }).dispose();
  }
}
