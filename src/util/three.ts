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
