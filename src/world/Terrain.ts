import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE, SEASON_TINT } from '@/rendering/palette';
import { clamp01, lerp, smoothstep } from '@/util/math';
import { fbm2D } from '@/util/rng';
import { hash2 } from '@/util/math';
import { ISLAND_HALF, PATHS, SEA_LEVEL, sampleSurface, terrainHeight, type Surface } from './heightfield';

/** Metres from a point to the nearest path edge, as a 0–1 falloff input. */
function distanceToPathEdge(x: number, z: number): number {
  let best = Infinity;
  for (const p of PATHS) {
    const dx = p.bx - p.ax;
    const dz = p.bz - p.az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq < 1e-6 ? 0 : clamp01(((x - p.ax) * dx + (z - p.az) * dz) / lenSq);
    const d = Math.hypot(x - (p.ax + dx * t), z - (p.az + dz * t)) - p.width * 0.5;
    if (d < best) best = d;
  }
  // Normalised against a 3 m apron.
  return clamp01(best / 3);
}

const SURFACE_COLORS: Record<Surface, [string, string]> = {
  grass: [PALETTE.grass.base, PALETTE.grass.highlight],
  sand: [PALETTE.sand.base, '#f4e5c2'],
  rock: [PALETTE.rock.base, PALETTE.rock.light],
  path: [PALETTE.dirt.path, '#e6cfa5'],
  plaza: ['#d8cfc0', '#efe8dc'],
  dirt: [PALETTE.dirt.base, '#cc9b6f'],
  water: [PALETTE.water.deep, PALETTE.water.mid],
  wood: [PALETTE.wood.plank, '#dcb98c'],
};

export interface TerrainOptions {
  /** Grid divisions across the island. Higher is smoother but costs vertices. */
  resolution?: number;
  extent?: number;
}

/**
 * The island's ground mesh.
 *
 * Colour is baked into vertices rather than sampled from a texture: it keeps
 * the painterly blend between grass, sand, path and rock, costs no texture
 * memory, and means the terrain is a single draw call. Season retinting walks
 * the colour buffer rather than rebuilding geometry.
 */
export class Terrain {
  readonly mesh: Mesh;
  private geometry: BufferGeometry;
  private baseColors: Float32Array;
  private surfaceIndex: Uint8Array;
  private resolution: number;
  private extent: number;

  constructor(options: TerrainOptions = {}) {
    this.resolution = options.resolution ?? 300;
    this.extent = options.extent ?? ISLAND_HALF * 2 + 40;

    const plane = new PlaneGeometry(this.extent, this.extent, this.resolution, this.resolution);
    plane.rotateX(-Math.PI / 2);
    this.geometry = plane;

    const position = plane.getAttribute('position') as BufferAttribute;
    const count = position.count;
    const colors = new Float32Array(count * 3);
    this.surfaceIndex = new Uint8Array(count);

    const color = new Color();
    const surfaceOrder: Surface[] = ['grass', 'sand', 'rock', 'path', 'plaza', 'dirt', 'water', 'wood'];

    for (let i = 0; i < count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const sample = sampleSurface(x, z);
      position.setY(i, sample.height);

      const [dark, light] = SURFACE_COLORS[sample.surface];
      // Two-tone variation driven by noise gives the ground a hand-painted
      // mottle instead of a flat fill.
      const mottle = fbm2D(x * 0.09, z * 0.09, 3, 7);
      const patch = fbm2D(x * 0.021, z * 0.021, 2, 19);
      const sweep = fbm2D(x * 0.008 + 3.1, z * 0.008 - 1.7, 2, 23);
      color.set(dark).lerp(new Color(light), clamp01(mottle * 0.6 + patch * 0.45 - 0.1));

      if (sample.surface === 'grass') {
        // Three broad washes — dry straw, cool moss, and the base — laid over
        // each other at different scales, so a meadow reads as painted ground
        // rather than one flat fill.
        color.lerp(new Color(PALETTE.grass.moss), smoothstep(0.35, 0.8, sweep) * 0.5);
        color.lerp(new Color(PALETTE.grass.dry), smoothstep(0.55, 0.9, patch) * 0.3);
        // Slopes catch less light, and grass thins out near rock.
        color.lerp(new Color(PALETTE.grass.shadow), sample.slope * 0.5);
        color.lerp(new Color(PALETTE.rock.base), smoothstep(0.42, 0.75, sample.slope) * 0.6);
        // Worn ground either side of the paths.
        const nearPath = smoothstep(0.32, 0.04, distanceToPathEdge(x, z));
        color.lerp(new Color(PALETTE.dirt.path), nearPath * 0.28);
      }
      if (sample.surface === 'sand') {
        // Wind ripples and the odd darker drift.
        color.lerp(new Color(PALETTE.sand.shadow), smoothstep(0.5, 0.85, mottle) * 0.35);
      }

      // Damp sand right at the waterline, and a wet band just below it.
      if (sample.height < 2.0 && sample.height > SEA_LEVEL - 1.2) {
        const wetness = 1 - smoothstep(SEA_LEVEL - 0.1, 1.9, sample.height);
        color.lerp(new Color(PALETTE.sand.wet), wetness * 0.7);
      }
      if (sample.height <= SEA_LEVEL) {
        const depth = clamp01((SEA_LEVEL - sample.height) / 6);
        color.lerp(new Color('#4b6b6f'), depth * 0.6);
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      this.surfaceIndex[i] = surfaceOrder.indexOf(sample.surface);
    }

    this.baseColors = colors.slice();
    plane.setAttribute('color', new Float32BufferAttribute(colors, 3));
    position.needsUpdate = true;
    plane.computeVertexNormals();
    plane.computeBoundingSphere();

    const material = createStylizedMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      wetResponse: 0.55,
      groundDetail: 0.85,
    });

    this.mesh = new Mesh(plane, material);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.noFade = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  /**
   * Retints grass and canopy colours for the season. Runs over the colour
   * buffer once per season change rather than per frame.
   */
  applySeason(season: string): void {
    const tint = SEASON_TINT[season] ?? SEASON_TINT.Spring;
    const attribute = this.geometry.getAttribute('color') as BufferAttribute;
    const target = new Color(tint.grass);
    const scratch = new Color();

    for (let i = 0; i < attribute.count; i++) {
      const i3 = i * 3;
      scratch.setRGB(this.baseColors[i3], this.baseColors[i3 + 1], this.baseColors[i3 + 2]);
      // Only grass shifts with the season; sand, rock and paving stay put.
      if (this.surfaceIndex[i] === 0) {
        scratch.lerp(target, 0.42);
        if (tint.saturation !== 1) {
          const luma = scratch.r * 0.2126 + scratch.g * 0.7152 + scratch.b * 0.0722;
          scratch.setRGB(
            lerp(luma, scratch.r, tint.saturation),
            lerp(luma, scratch.g, tint.saturation),
            lerp(luma, scratch.b, tint.saturation),
          );
        }
      }
      attribute.setXYZ(i, scratch.r, scratch.g, scratch.b);
    }
    attribute.needsUpdate = true;
  }

  /** Surface normal at a world position, for aligning props to the ground. */
  normalAt(x: number, z: number, out = new Vector3()): Vector3 {
    const e = 0.5;
    const hL = terrainHeight(x - e, z);
    const hR = terrainHeight(x + e, z);
    const hD = terrainHeight(x, z - e);
    const hU = terrainHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Random point on land inside a radius, biased away from steep ground. */
  static scatterPoint(cx: number, cz: number, radius: number, seed: number): { x: number; z: number; height: number } | null {
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = hash2(seed + attempt * 3.1, 1.7) * Math.PI * 2;
      const r = Math.sqrt(hash2(seed + attempt * 7.3, 5.9)) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const sample = sampleSurface(x, z);
      if (sample.height > 1.4 && sample.slope < 0.5) return { x, z, height: sample.height };
    }
    return null;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
  }
}
