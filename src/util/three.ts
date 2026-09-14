import type { Material, Mesh, Object3D } from 'three';

/**
 * Releases the GPU resources a subtree owns.
 *
 * Geometries are easy to remember and materials are easy to forget, which is
 * how a session that swaps tools or re-decorates a room a few dozen times ends
 * up holding every material it ever built. Materials are de-duplicated because
 * a model routinely shares one across several meshes.
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

  for (const material of materials) material.dispose();
}
