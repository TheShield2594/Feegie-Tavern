import { BufferGeometry, Float32BufferAttribute } from 'three';
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
 * Textures go too — most are baked per call, like the building kit's sign
 * lettering.
 *
 * Anything marked `userData.shared` is left alone. Several caches in the
 * project hand the same instance to every caller that asks: the procedural
 * texture bakery keys its output, and the asset registry keys kit geometry and
 * kit materials. Those predate anything being torn down piecemeal — a scene
 * used to be disposed whole, at which point freeing them was correct — but
 * outdoor decorations are built and removed one at a time while the game runs,
 * and taking up one bench must not free the plank texture the pier is drawn
 * with. A caller that wants to own its copy clones it.
 */
/**
 * A copy of a geometry the caller owns outright, safe to dispose.
 *
 * `BufferGeometry.copy` assigns `userData` by reference rather than copying it,
 * so a plain `clone()` of a shared geometry comes back still marked shared —
 * and pointing at the original's own `userData`, where clearing the flag in
 * place would un-share the original too. This hands back a copy with its own
 * `userData` and the marker dropped, so {@link disposeObject} frees it like
 * anything else while the registry's instance stays protected.
 */
export function cloneOwned(geometry: BufferGeometry): BufferGeometry {
  const copy = geometry.clone();
  copy.userData = { ...geometry.userData, shared: false };
  return copy;
}

export function disposeObject(root: Object3D): void {
  const materials = new Set<Material>();

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) materials.add(m);
    else if (material) materials.add(material);
  });

  for (const material of materials) {
    if (material.userData.shared) continue;
    const slots = material as unknown as Record<string, Texture | null | undefined>;
    for (const slot of TEXTURE_SLOTS) {
      const texture = slots[slot];
      if (texture && !texture.userData.shared) texture.dispose();
    }
    material.dispose();
  }
}

/**
 * Minimal geometry merge for indexed or non-indexed position+normal+uv buffers.
 *
 * Avoids pulling in BufferGeometryUtils for the handful of merges the world
 * builders need: every instanced clump — a mushroom, a herb tuft, a reed — is
 * several primitives that have to end up as one geometry to be instanced.
 */
export function mergeGeometries(geometries: BufferGeometry[]): BufferGeometry {
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
