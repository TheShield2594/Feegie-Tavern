import {
  Box3,
  BufferGeometry,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
import type { NormalizeOptions } from './manifest';

/**
 * Turning a downloaded kit into geometry this renderer can use.
 *
 * The world systems own their materials — one shared `createStylizedMaterial`
 * per surface type, mutated in place by `applySeason` and driven by the shared
 * wind/wetness uniforms. An imported mesh that kept its own GLTF material would
 * drop straight out of that system: no season tint, no wind, no rain response.
 *
 * So nothing here returns a Mesh or a Material. It returns bare
 * `BufferGeometry`, which the systems feed to their existing `InstancedMesh`
 * setups exactly as they feed procedural geometry today.
 */

const _box = new Box3();
const _centre = new Vector3();
const _matrix = new Matrix4();

/** Attributes we keep. Anything else (tangents, extra UV sets) is dead weight. */
const KEPT_ATTRIBUTES = ['position', 'normal', 'uv', 'color'] as const;

/**
 * Drops attributes the stylised materials never read — tangents, extra UV sets,
 * morph targets, and vertex colours when the model is not colour-baked — so a
 * kit costs only what it actually draws.
 */
function stripAttributes(geometry: BufferGeometry, keepVertexColors: boolean): void {
  for (const name of Object.keys(geometry.attributes)) {
    const kept = (KEPT_ATTRIBUTES as readonly string[]).includes(name);
    if (!kept || (name === 'color' && !keepVertexColors)) {
      geometry.deleteAttribute(name);
    }
  }
  // Morph targets come along with some rigged kits and cost memory we never use
  // for instanced scenery.
  geometry.morphAttributes = {};
}

/**
 * Conditions one geometry for instancing: bakes the node's world transform,
 * drops unused attributes, and moves the origin to the base so the wind shader's
 * local-Y stiffness term and terrain placement both behave.
 */
export function normalizeGeometry(
  geometry: BufferGeometry,
  worldMatrix: Matrix4,
  options: NormalizeOptions = {},
): BufferGeometry {
  const { groundOrigin = true, centreXZ = true, scale, keepVertexColors = false } = options;

  const out = geometry.clone();
  out.applyMatrix4(worldMatrix);
  stripAttributes(out, keepVertexColors);

  if (scale !== undefined && scale !== 1) {
    out.applyMatrix4(_matrix.makeScale(scale, scale, scale));
  }

  if (groundOrigin || centreXZ) {
    out.computeBoundingBox();
    const box = out.boundingBox ?? _box.makeEmpty();
    box.getCenter(_centre);
    const dx = centreXZ ? -_centre.x : 0;
    const dy = groundOrigin ? -box.min.y : 0;
    const dz = centreXZ ? -_centre.z : 0;
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      out.applyMatrix4(_matrix.makeTranslation(dx, dy, dz));
    }
  }

  if (!out.getAttribute('normal')) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export interface ExtractedModel {
  node: string;
  geometry: BufferGeometry;
}

/**
 * Pulls every mesh out of a loaded GLB scene, keyed by node name.
 *
 * Kit GLBs nest meshes under transform nodes, so the world matrix is baked per
 * mesh rather than assumed to be identity. A node holding several primitives
 * yields one entry per primitive, suffixed, because three splits multi-material
 * primitives into sibling meshes on import.
 */
/**
 * Per-node normalisation. A plain object applies to every node; a function is
 * asked for each node by name, which is what lets one kit hold models that need
 * different scales and grounding — the common case, since a kit is authored at
 * its own size and each model is fitted to what it replaces.
 */
export type NormalizeFor = NormalizeOptions | ((node: string) => NormalizeOptions);

/**
 * Every named mesh in a loaded glTF scene, as world-space geometry.
 *
 * Node transforms are baked in rather than kept on a parent, because the game
 * instances these geometries directly and an `InstancedMesh` carries no scene
 * graph of its own. `resolve` supplies the per-node normalisation, so one kit
 * can hold models the manifest wants grounded, centred or left alone.
 */
export function extractGeometries(
  root: Object3D,
  options: NormalizeFor = {},
): Map<string, BufferGeometry> {
  root.updateWorldMatrix(true, true);

  const seen = new Map<string, number>();
  const out = new Map<string, BufferGeometry>();

  root.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;

    const base = mesh.name || mesh.parent?.name || 'unnamed';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const key = count === 0 ? base : `${base}_${count}`;

    const nodeOptions = typeof options === 'function' ? options(key) : options;
    out.set(key, normalizeGeometry(mesh.geometry, mesh.matrixWorld, nodeOptions));
  });

  return out;
}

/** Vertex + triangle counts, for the budget numbers in the asset report. */
export function geometryStats(geometry: BufferGeometry): { vertices: number; triangles: number } {
  const position = geometry.getAttribute('position') as BufferAttribute | InterleavedBufferAttribute | undefined;
  const vertices = position ? position.count : 0;
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : vertices / 3;
  return { vertices, triangles: Math.floor(triangles) };
}
