import {
  Color,
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
import { PALETTE } from '@/rendering/palette';
import { Rng } from '@/util/rng';
import { clamp01, lerp, smoothstep } from '@/util/math';
import { ISLAND_HALF, LANDMARKS, sampleSurface } from './heightfield';

interface Butterfly {
  anchor: Vector3;
  phase: number;
  speed: number;
  radius: number;
  height: number;
  scale: number;
  position: Vector3;
  heading: number;
}

interface Gull {
  centre: Vector3;
  radius: number;
  height: number;
  phase: number;
  speed: number;
  direction: 1 | -1;
}

const BUTTERFLY_COUNT = 36;
const GULL_COUNT = 7;

/**
 * Ambient animals: butterflies over the meadows by day, gulls wheeling over
 * the harbour and the lighthouse. Purely local and purely cosmetic — nothing
 * here is gameplay, and nothing here would ever need to be synchronised.
 *
 * Both are one instanced mesh per wing, so the whole population is four draw
 * calls, and both fade out by scaling to zero rather than toggling visibility,
 * so a butterfly never pops out of existence in front of the player.
 */
export class Wildlife {
  readonly group = new Group();

  private butterflies: Butterfly[] = [];
  private wingL: InstancedMesh;
  private wingR: InstancedMesh;

  private gulls: Gull[] = [];
  private gullWingL: InstancedMesh;
  private gullWingR: InstancedMesh;

  private dummy = new Object3D();
  private matrix = new Matrix4();
  private quat = new Quaternion();
  private scratch = new Vector3();
  private time = 0;
  private butterflyLevel = 0;
  private gullLevel = 0;

  constructor() {
    this.group.name = 'Wildlife';
    const rng = new Rng(4242);

    // --- Butterflies -----------------------------------------------------
    const wing = new PlaneGeometry(0.16, 0.12);
    // Hinge on the body edge so the flap rotates around it.
    wing.translate(0.08, 0, 0);
    const wingMaterial = createStylizedMaterial({
      color: '#ffffff',
      roughness: 0.9,
      side: DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    this.wingL = new InstancedMesh(wing, wingMaterial, BUTTERFLY_COUNT);
    this.wingR = new InstancedMesh(wing, wingMaterial, BUTTERFLY_COUNT);
    this.wingL.name = 'ButterflyWingsL';
    this.wingR.name = 'ButterflyWingsR';
    this.wingL.frustumCulled = false;
    this.wingR.frustumCulled = false;
    this.wingL.castShadow = false;
    this.wingR.castShadow = false;
    this.group.add(this.wingL, this.wingR);

    const tints = [...PALETTE.flowers, '#ffffff', '#f4d35e', '#8fc1e3'];
    const color = new Color();
    let placed = 0;
    let attempts = 0;
    while (placed < BUTTERFLY_COUNT && attempts < 3000) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 14);
      const z = rng.spread(ISLAND_HALF - 14);
      const sample = sampleSurface(x, z);
      if (sample.surface !== 'grass' || sample.height < 2.2 || sample.slope > 0.4) continue;
      this.butterflies.push({
        anchor: new Vector3(x, sample.height, z),
        phase: rng.range(0, Math.PI * 2),
        speed: rng.range(0.35, 0.7),
        radius: rng.range(1.2, 3.2),
        height: rng.range(0.6, 1.4),
        scale: rng.range(0.8, 1.25),
        position: new Vector3(x, sample.height + 1, z),
        heading: 0,
      });
      color.set(rng.pick(tints));
      this.wingL.setColorAt(placed, color);
      this.wingR.setColorAt(placed, color);
      placed++;
    }
    this.wingL.count = placed;
    this.wingR.count = placed;
    if (this.wingL.instanceColor) this.wingL.instanceColor.needsUpdate = true;
    if (this.wingR.instanceColor) this.wingR.instanceColor.needsUpdate = true;

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
   * @param rain Precipitation, 0–1. Butterflies shelter; gulls thin out.
   */
  update(dt: number, daylight: number, rain: number, season: string, wind: number, cameraX: number, cameraZ: number): void {
    this.time += dt;

    const butterflyTarget = smoothstep(0.25, 0.6, daylight) * (1 - clamp01(rain * 2.5)) * (season === 'Winter' ? 0 : 1);
    this.butterflyLevel = lerp(this.butterflyLevel, butterflyTarget, 1 - Math.exp(-dt * 0.8));
    const gullTarget = smoothstep(0.1, 0.4, daylight) * (1 - clamp01(rain * 1.5) * 0.7);
    this.gullLevel = lerp(this.gullLevel, gullTarget, 1 - Math.exp(-dt * 0.6));

    this.updateButterflies(dt, cameraX, cameraZ, wind);
    this.updateGulls(dt, cameraX, cameraZ);
  }

  private updateButterflies(dt: number, cameraX: number, cameraZ: number, wind: number): void {
    const level = this.butterflyLevel;
    const flap = this.time * 14;
    for (let i = 0; i < this.butterflies.length; i++) {
      const b = this.butterflies[i];
      const dx = b.anchor.x - cameraX;
      const dz = b.anchor.z - cameraZ;
      if (dx * dx + dz * dz > 55 * 55 || level < 0.01) {
        this.hide(this.wingL, i);
        this.hide(this.wingR, i);
        continue;
      }

      // A lazy figure-of-eight around the anchor, drifting with the wind.
      const t = this.time * b.speed + b.phase;
      const nx = b.anchor.x + Math.sin(t) * b.radius + wind * 0.4;
      const nz = b.anchor.z + Math.sin(t * 2) * b.radius * 0.5;
      const ny = b.anchor.y + b.height + Math.sin(t * 3.1) * 0.25 + Math.sin(flap * 0.5 + b.phase) * 0.04;
      const vx = nx - b.position.x;
      const vz = nz - b.position.z;
      if (vx * vx + vz * vz > 1e-6) {
        const heading = Math.atan2(vx, vz);
        let delta = heading - b.heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        b.heading += delta * Math.min(1, dt * 6);
      }
      b.position.set(nx, ny, nz);

      const s = b.scale * level * 0.9;
      const beat = Math.sin(flap + b.phase * 5);
      const open = 0.35 + Math.abs(beat) * 1.05;
      // Left wing: rotate about the body axis (local Z) by +open, right by -open.
      this.writeWing(this.wingL, i, b.position, b.heading, open, s, 1);
      this.writeWing(this.wingR, i, b.position, b.heading, -open, s, -1);
    }
    this.wingL.instanceMatrix.needsUpdate = true;
    this.wingR.instanceMatrix.needsUpdate = true;
  }

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

  private hide(mesh: InstancedMesh, index: number): void {
    this.matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(index, this.matrix);
  }

  dispose(): void {
    this.wingL.dispose();
    this.wingR.dispose();
    this.gullWingL.dispose();
    this.gullWingR.dispose();
  }
}
