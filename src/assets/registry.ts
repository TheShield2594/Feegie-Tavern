import { Color, Mesh, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import type { AssetManager } from './AssetManager';

/**
 * Process-wide access to the loaded kits.
 *
 * `Foliage` takes the `AssetManager` as a constructor argument because it was
 * the first system to use kit art. Every other consumer — props, interiors,
 * furniture, item drops, tools — is built several layers down and would need
 * the manager threaded through half a dozen signatures. This registry is the
 * same manager reached by module import instead; `Game` sets it once before
 * building the world.
 *
 * Everything here returns `null` when the kits are absent, and every caller
 * keeps its procedural fallback. That rule is what lets the game boot with no
 * assets at all, and it is not negotiable.
 */

let manager: AssetManager | null = null;
const materialCache = new Map<string, MeshStandardMaterial>();

/** Points the registry at the loaded kits. Called once by `Game` before the world is built. */
export function setAssets(assets: AssetManager | undefined): void {
  manager = assets ?? null;
}

/** Geometry for a manifest id, or null when no kit supplies it. */
export function kitGeometry(id: string): BufferGeometry | null {
  return manager?.geometry(id) ?? null;
}

/** Whether a manifest id resolved to real geometry. */
export function hasKit(id: string): boolean {
  return !!manager?.has(id);
}

export interface KitMaterialOptions {
  /** Multiplies the baked vertex colours; white leaves the kit's own palette. */
  tint?: string;
  roughness?: number;
  wind?: 'none' | 'foliage' | 'canopy';
  windScale?: number;
  wetResponse?: number;
}

/**
 * A shared material for colour-baked kit meshes. Cached per option set so a
 * hundred crates share one program and one material instance.
 */
export function kitMaterial(options: KitMaterialOptions = {}): MeshStandardMaterial {
  const { tint = '#ffffff', roughness = 0.9, wind = 'none', windScale = 1, wetResponse = 0.35 } = options;
  const key = `${tint}|${roughness}|${wind}|${windScale}|${wetResponse}`;
  let material = materialCache.get(key);
  if (!material) {
    material = createStylizedMaterial({ vertexColors: true, color: tint, roughness, wind, windScale, wetResponse });
    materialCache.set(key, material);
  }
  return material;
}

/**
 * Blends a kit's baked colours toward a palette colour without crushing them:
 * a straight multiply by a mid-tone halves the brightness of everything, so
 * the tint is lifted toward white first.
 */
export function softTint(color: string, strength = 0.45): string {
  const c = new Color('#ffffff').lerp(new Color(color), strength);
  return `#${c.getHexString()}`;
}

export interface KitMeshOptions extends KitMaterialOptions {
  scale?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** A ready-to-place mesh for a kit model, or null when the kit is missing. */
export function makeKitMesh(id: string, options: KitMeshOptions = {}): Mesh | null {
  const geometry = kitGeometry(id);
  if (!geometry) return null;
  const mesh = new Mesh(geometry, kitMaterial(options));
  mesh.name = `Kit_${id}`;
  if (options.scale !== undefined) mesh.scale.setScalar(options.scale);
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  return mesh;
}
