import {
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '@/core/EventBus';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { PRODUCE } from '@/data/items';
import { clamp01 } from '@/util/math';
import { roundedBoxGeometry } from '@/world/BuildingKit';
import { sampleSurface, terrainHeight } from '@/world/heightfield';
import type { CropPlotData } from '@/save/schema';

export type GrowthStage = 'tilled' | 'seed' | 'sprout' | 'growing' | 'mature';

/** In-game minutes to move through the whole cycle. */
export const GROWTH_DURATION = 960;
const STAGE_THRESHOLDS: [GrowthStage, number][] = [
  ['seed', 0],
  ['sprout', 0.18],
  ['growing', 0.48],
  ['mature', 1],
];

export interface CropPlot extends CropPlotData {
  y: number;
  /** Runtime pop animation when a stage changes or the crop is harvested. */
  popTimer: number;
  lastStage: GrowthStage;
}

const MAX_PLOTS = 120;

/**
 * The farm.
 *
 * Every growth stage the brief asks for is a visible mesh: turned soil, a
 * darker watered patch, a sprout, a leafy plant, and the ripe crop itself.
 * Plots are instanced so a fully planted terrace is still four draw calls.
 */
export class Farm {
  readonly group = new Group();
  readonly plots: CropPlot[] = [];

  private soilMesh: InstancedMesh;
  private wetMesh: InstancedMesh;
  private plantMesh: InstancedMesh;
  private cropMesh: InstancedMesh;
  private dummy = new Object3D();
  private hidden = new Vector3(0, -1000, 0);
  private dirty = true;

  constructor(private bus: EventBus) {
    this.group.name = 'Farm';

    const soilGeometry = roundedBoxGeometry(1.0, 0.16, 1.0, 0.14);
    this.soilMesh = new InstancedMesh(soilGeometry, createStylizedMaterial({ color: PALETTE.dirt.tilled, roughness: 0.99 }), MAX_PLOTS);
    this.soilMesh.receiveShadow = true;
    this.soilMesh.name = 'Soil';

    const wetGeometry = roundedBoxGeometry(0.92, 0.05, 0.92, 0.12);
    this.wetMesh = new InstancedMesh(
      wetGeometry,
      createStylizedMaterial({ color: '#4f3620', roughness: 0.55, transparent: true, opacity: 0.85 }),
      MAX_PLOTS,
    );
    this.wetMesh.name = 'WateredSoil';

    // The leafy body of the plant, scaled through the growth stages.
    const plantGeometry = new IcosahedronGeometry(0.3, 0);
    this.plantMesh = new InstancedMesh(
      plantGeometry,
      createStylizedMaterial({ color: '#6f9a55', roughness: 0.9, flatShading: true, wind: 'foliage', windScale: 1.2 }),
      MAX_PLOTS,
    );
    this.plantMesh.castShadow = true;
    this.plantMesh.name = 'CropFoliage';

    const cropGeometry = new SphereGeometry(0.2, 10, 8);
    this.cropMesh = new InstancedMesh(cropGeometry, createStylizedMaterial({ color: '#e08e3c', roughness: 0.75 }), MAX_PLOTS);
    this.cropMesh.castShadow = true;
    this.cropMesh.name = 'CropFruit';

    this.group.add(this.soilMesh, this.wetMesh, this.plantMesh, this.cropMesh);
    this.refresh();

    // A few stakes so the terrace reads as a garden even before anything grows.
    const stakeMaterial = createStylizedMaterial({ color: PALETTE.wood.plankDark, roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
      const x = -44 + (i % 3) * 4;
      const z = 22 + Math.floor(i / 3) * 5;
      const stake = new Mesh(new CylinderGeometry(0.05, 0.06, 1.3, 6), stakeMaterial);
      stake.position.set(x, terrainHeight(x, z) + 0.6, z);
      stake.castShadow = true;
      this.group.add(stake);
    }
  }

  static stageFor(growth: number): GrowthStage {
    const t = clamp01(growth / GROWTH_DURATION);
    let stage: GrowthStage = 'seed';
    for (const [name, threshold] of STAGE_THRESHOLDS) {
      if (t >= threshold) stage = name;
    }
    return stage;
  }

  /** Can this spot take a plot? */
  canTill(x: number, z: number): boolean {
    const sample = sampleSurface(x, z);
    if (sample.height < 1.4 || sample.slope > 0.3) return false;
    if (sample.surface !== 'grass' && sample.surface !== 'dirt') return false;
    return !this.plots.some((p) => Math.hypot(p.x - x, p.z - z) < 1.05);
  }

  till(x: number, z: number, day: number): CropPlot | null {
    if (this.plots.length >= MAX_PLOTS || !this.canTill(x, z)) return null;
    // Snap to a 1 m grid so rows line up instead of scattering.
    const gx = Math.round(x);
    const gz = Math.round(z);
    if (this.plots.some((p) => p.x === gx && p.z === gz)) return null;

    const plot: CropPlot = {
      id: `plot_${Date.now().toString(36)}_${this.plots.length}`,
      x: gx,
      z: gz,
      y: terrainHeight(gx, gz),
      cropId: '',
      growth: 0,
      watered: false,
      wateredOnDay: day - 1,
      tilled: true,
      popTimer: 0.35,
      lastStage: 'tilled',
    };
    this.plots.push(plot);
    this.dirty = true;
    this.bus.emit('audio:sfx', { id: 'tool.dig' });
    return plot;
  }

  plant(plot: CropPlot, cropId?: string): boolean {
    if (plot.cropId) return false;
    const def = cropId ? PRODUCE.find((p) => p.id === cropId) : PRODUCE[Math.floor(Math.random() * 3)];
    if (!def) return false;
    plot.cropId = def.id;
    plot.growth = 0;
    plot.popTimer = 0.4;
    plot.lastStage = 'seed';
    this.dirty = true;
    this.bus.emit('audio:sfx', { id: 'tool.plant' });
    return true;
  }

  water(plot: CropPlot, day: number): boolean {
    if (plot.watered && plot.wateredOnDay === day) return false;
    plot.watered = true;
    plot.wateredOnDay = day;
    this.dirty = true;
    return true;
  }

  /** Waters every plot within a radius — a better can covers more ground. */
  waterArea(x: number, z: number, radius: number, day: number): number {
    let count = 0;
    for (const plot of this.plots) {
      if (Math.hypot(plot.x - x, plot.z - z) <= radius && this.water(plot, day)) count++;
    }
    if (count > 0) this.bus.emit('audio:sfx', { id: 'tool.water' });
    return count;
  }

  harvest(plot: CropPlot): string | null {
    if (Farm.stageFor(plot.growth) !== 'mature' || !plot.cropId) return null;
    const cropId = plot.cropId;
    plot.cropId = '';
    plot.growth = 0;
    plot.watered = false;
    plot.popTimer = 0.4;
    plot.lastStage = 'tilled';
    this.dirty = true;
    this.bus.emit('audio:sfx', { id: 'item.harvest' });
    return cropId;
  }

  plotNear(x: number, z: number, radius = 1.4): CropPlot | null {
    let best: CropPlot | null = null;
    let bestDist = radius * radius;
    for (const plot of this.plots) {
      const d = (plot.x - x) ** 2 + (plot.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = plot;
      }
    }
    return best;
  }

  /** Advances growth. Watered plots grow at full rate; dry ones crawl. */
  advance(minutes: number, day: number): void {
    let changed = false;
    for (const plot of this.plots) {
      if (!plot.cropId) continue;
      const rate = plot.watered && plot.wateredOnDay >= day - 1 ? 1 : 0.35;
      const before = Farm.stageFor(plot.growth);
      plot.growth = Math.min(GROWTH_DURATION, plot.growth + minutes * rate);
      const after = Farm.stageFor(plot.growth);
      if (after !== before) {
        plot.popTimer = 0.35;
        plot.lastStage = after;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
  }

  /** Soil dries out overnight. */
  newDay(day: number): void {
    for (const plot of this.plots) {
      if (plot.wateredOnDay < day) plot.watered = false;
    }
    this.dirty = true;
  }

  update(dt: number): void {
    let animating = false;
    for (const plot of this.plots) {
      if (plot.popTimer > 0) {
        plot.popTimer = Math.max(0, plot.popTimer - dt);
        animating = true;
      }
    }
    if (animating || this.dirty) this.refresh();
    this.dirty = false;
  }

  private refresh(): void {
    const cropColor = new Color();
    for (let i = 0; i < MAX_PLOTS; i++) {
      const plot = this.plots[i];
      if (!plot) {
        this.writeHidden(this.soilMesh, i);
        this.writeHidden(this.wetMesh, i);
        this.writeHidden(this.plantMesh, i);
        this.writeHidden(this.cropMesh, i);
        continue;
      }

      // A short squash-and-stretch whenever the plot changes state.
      const pop = plot.popTimer > 0 ? 1 + Math.sin((1 - plot.popTimer / 0.4) * Math.PI) * 0.22 : 1;

      this.dummy.position.set(plot.x, plot.y + 0.06, plot.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.soilMesh.setMatrixAt(i, this.dummy.matrix);

      if (plot.watered) {
        this.dummy.position.set(plot.x, plot.y + 0.15, plot.z);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.wetMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.writeHidden(this.wetMesh, i);
      }

      if (!plot.cropId) {
        this.writeHidden(this.plantMesh, i);
        this.writeHidden(this.cropMesh, i);
        continue;
      }

      const t = clamp01(plot.growth / GROWTH_DURATION);
      const stage = Farm.stageFor(plot.growth);
      const foliageScale = stage === 'seed' ? 0.2 : 0.35 + t * 1.05;

      this.dummy.position.set(plot.x, plot.y + 0.14 + foliageScale * 0.16, plot.z);
      this.dummy.rotation.set(0, plot.x * 1.7 + plot.z, 0);
      this.dummy.scale.set(foliageScale * pop, foliageScale * 0.9 * pop, foliageScale * pop);
      this.dummy.updateMatrix();
      this.plantMesh.setMatrixAt(i, this.dummy.matrix);

      if (stage === 'mature') {
        const def = PRODUCE.find((p) => p.id === plot.cropId);
        cropColor.set(def?.visual.primary ?? '#e08e3c');
        this.cropMesh.setColorAt(i, cropColor);
        // Pumpkins sit on the soil; berries and roots ride on the plant.
        const lift = plot.cropId === 'crop.pumpkin' ? 0.28 : 0.52;
        const size = plot.cropId === 'crop.pumpkin' ? 1.5 : plot.cropId === 'crop.strawberry' ? 0.7 : 1.0;
        this.dummy.position.set(plot.x, plot.y + lift, plot.z);
        this.dummy.rotation.set(0, plot.x, 0);
        this.dummy.scale.setScalar(size * pop);
        this.dummy.updateMatrix();
        this.cropMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.writeHidden(this.cropMesh, i);
      }
    }

    for (const mesh of [this.soilMesh, this.wetMesh, this.plantMesh, this.cropMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.cropMesh.instanceColor) this.cropMesh.instanceColor.needsUpdate = true;
  }

  private writeHidden(mesh: InstancedMesh, index: number): void {
    this.dummy.position.copy(this.hidden);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  load(data: CropPlotData[]): void {
    this.plots.length = 0;
    for (const raw of data.slice(0, MAX_PLOTS)) {
      this.plots.push({
        ...raw,
        y: terrainHeight(raw.x, raw.z),
        popTimer: 0,
        lastStage: Farm.stageFor(raw.growth),
      });
    }
    this.dirty = true;
  }

  serialize(): CropPlotData[] {
    return this.plots.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      cropId: p.cropId,
      growth: p.growth,
      watered: p.watered,
      wateredOnDay: p.wateredOnDay,
      tilled: p.tilled,
    }));
  }

  get stats(): { total: number; planted: number; ready: number; dry: number } {
    let planted = 0;
    let ready = 0;
    let dry = 0;
    for (const plot of this.plots) {
      if (!plot.cropId) continue;
      planted++;
      if (Farm.stageFor(plot.growth) === 'mature') ready++;
      if (!plot.watered) dry++;
    }
    return { total: this.plots.length, planted, ready, dry };
  }

  dispose(): void {
    this.soilMesh.dispose();
    this.wetMesh.dispose();
    this.plantMesh.dispose();
    this.cropMesh.dispose();
  }
}
