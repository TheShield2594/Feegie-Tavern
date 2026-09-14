import type { Material, Mesh, Object3D, Texture } from 'three';

/** Material slots that may hold a texture the material alone owns. */
const TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
] as const;

/**
 * Releases the GPU resources a subtree owns.
 *
 * Geometries are easy to remember and materials are easy to forget, which is
 * how a session that swaps tools or re-decorates a room a few dozen times ends
 * up holding every material it ever built. Materials are de-duplicated because
 * a model routinely shares one across several meshes.
 *
 * Textures go too. Every texture in this project is built per call — the room
 * kit bakes a floor pattern, the building kit bakes sign lettering — so none of
 * them is a shared cache that another scene still needs.
 */
export function disposeObject(root: Object3D): void {
  const materials = new Set<Material>();

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) materials.add(m);
    else if (material) materials.add(material);
  });

  for (const material of materials) {
    const slots = material as unknown as Record<string, Texture | null | undefined>;
    for (const slot of TEXTURE_SLOTS) slots[slot]?.dispose();
    material.dispose();
  }
}
