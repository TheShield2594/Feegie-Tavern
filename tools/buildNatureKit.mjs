/**
 * Builds `public/assets/models/nature/nature.glb` from the Kenney Nature Kit.
 *
 *   node tools/buildNatureKit.mjs <path-to-kenney_nature-kit/Models/GLTF format>
 *
 * Why this exists rather than a `gltf-transform` invocation: the §5 pipeline
 * calls for prune → weld → merge → one GLB per category, and this session could
 * not install `@gltf-transform/cli` (the npm registry is blocked — see
 * `docs/ASSET_PLAN.md` §9). The transforms below are the subset the Kenney kits
 * actually need, done directly on the glTF buffers:
 *
 *  - **Prune.** Only the models the game places are read; the other ~320 in the
 *    kit are never opened. Degenerate (zero-area) triangles are dropped too —
 *    `tree_oak` ships two in its bark primitive.
 *  - **Compose node transforms.** Not every model is flat: `tree_palmDetailedTall`
 *    parents its fronds under the trunk, one rotated 45° and scaled on Y alone,
 *    so the full TRS chain is walked and normals go through the inverse
 *    transpose rather than being rotated and renormalised.
 *  - **Split by material role.** A Kenney tree is one mesh with two primitives
 *    sharing one vertex buffer: bark and leaves. The renderer wants those as
 *    separate geometries so `Foliage` can bind its own bark/canopy materials
 *    (see ASSET_PLAN §7.1 — imported meshes must re-bind to
 *    `createStylizedMaterial` or they lose season tint, wind and wetness).
 *    Roles are resolved by **material name, not primitive index**: the kit is
 *    not consistent about ordering (`tree_default` is bark-first, `tree_oak` is
 *    leaves-first), so indexing by position silently swaps trunk and canopy.
 *  - **Weld/compact.** Each output primitive keeps only the vertices its own
 *    indices reference, so the bark geometry stops carrying the leaf vertices.
 *  - **Strip.** `TEXCOORD_0` is dropped: the kit is untextured (flat
 *    `baseColorFactor` only) and the wind shader derives stiffness from
 *    `transformed.y` for canopy/foliage, not from `uv`. Materials are dropped
 *    wholesale for the same reason — the palette supplies the colour.
 *  - **Narrow indices.** Sources use UINT32 for meshes of a few hundred
 *    vertices; UINT16 is enough and halves the index buffer.
 *  - **Ground origin, once per model.** The base of the *whole tree* is moved
 *    to y = 0 and centred on XZ here, with trunk and canopy translated
 *    together. Doing it per part instead (which is what `normalizeGeometry`'s
 *    `groundOrigin` would do) would drop the canopy to the ground and take the
 *    tree apart, so the manifest entries set `groundOrigin: false` and rely on
 *    this step.
 *
 * Output is one GLB per category with one single-primitive mesh per node, so
 * `extractGeometries` yields exactly the node names listed in the manifest.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const USHORT = 5123;
const UINT = 5125;

/** Which material name means what. Matched longest-prefix first. */
const ROLE_BY_MATERIAL = [
  ['woodBark', 'trunk'],
  ['woodBirch', 'trunk'],
  ['wood', 'trunk'],
  ['leafs', 'canopy'],
  ['leaves', 'canopy'],
  ['grass', 'whole'],
];

/**
 * The models the game actually places, and the roles to keep from each.
 * Kept deliberately small: ASSET_PLAN §5 step 1 is "import only the models
 * actually placed — not all 330".
 */
const SOURCES = [
  { file: 'tree_default', roles: ['trunk', 'canopy'] },
  { file: 'tree_oak', roles: ['trunk', 'canopy'] },
  { file: 'tree_pineDefaultA', roles: ['trunk', 'canopy'] },
  // A tall palm rather than `tree_palmShort`: the short one had to be scaled
  // ×5.7 to reach the height the procedural palm occupied, which made its trunk
  // read far thicker than every other tree's. This one needs roughly half that.
  // It is also the model that requires the transform composition above, since
  // its fronds are rotated child nodes.
  { file: 'tree_palmDetailedTall', roles: ['trunk', 'canopy'] },
  // `plant_bushDetailed` over `plant_bush`: the procedural bush it replaces is
  // a wide blob, and the plain one is a sparse few leaves that left ground
  // cover looking thin.
  { file: 'plant_bushDetailed', roles: ['whole'] },
  { file: 'plant_bushLarge', roles: ['whole'] },
];

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`not a GLB: ${path}`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = Buffer.from(data);
    offset += 8 + length;
  }
  if (!json) throw new Error(`no JSON chunk: ${path}`);
  return { json, bin };
}

/** Reads an accessor out of the BIN chunk into a plain array of numbers. */
function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Array(accessor.count * components);

  for (let i = 0; i < accessor.count * components; i++) {
    const at = base + i * (accessor.componentType === FLOAT || accessor.componentType === UINT ? 4 : 2);
    if (accessor.componentType === FLOAT) out[i] = bin.readFloatLE(at);
    else if (accessor.componentType === UINT) out[i] = bin.readUInt32LE(at);
    else if (accessor.componentType === USHORT) out[i] = bin.readUInt16LE(at);
    else throw new Error(`unsupported componentType ${accessor.componentType}`);
  }
  return out;
}

function roleOf(materialName) {
  for (const [prefix, role] of ROLE_BY_MATERIAL) {
    if (materialName.startsWith(prefix)) return role;
  }
  return null;
}

// --- node transforms -------------------------------------------------------
//
// Kit models are not all flat. `tree_palmDetailedTall` parents two `leafs`
// meshes under the trunk, one of them rotated 45° and scaled 1.35 on Y alone.
// Reading only a node's own translation — which an earlier version of this
// script did — silently dropped that rotation and left the fronds crossed and
// squashed, so the whole chain is composed here, rotation included.

/** Column-major 4x4, glTF's convention. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Builds T * R * S for a node, or takes its explicit matrix when it has one. */
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** World matrix per mesh index, by walking the scene graph from its roots. */
function meshMatrices(json) {
  const out = new Map();
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) out.set(node.mesh, world);
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(root, IDENTITY);
  // A mesh on no reachable node still gets identity rather than being skipped.
  for (let i = 0; i < json.meshes.length; i++) if (!out.has(i)) out.set(i, IDENTITY);
  return out;
}

const transformPoint = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/**
 * Inverse transpose of the upper 3x3, which is what normals transform by.
 *
 * A plain rotate-and-renormalise is only correct under uniform scale; the
 * palm's 1.35 on Y alone would skew its frond normals and light them wrongly.
 * Falls back to the plain upper 3x3 for a degenerate (non-invertible) matrix.
 */
function normalMatrix(m) {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a12 * a20 - a10 * a22;
  const c02 = a10 * a21 - a11 * a20;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-12) return a;
  const d = 1 / det;
  // inverse = adj/det; transposed inverse reorders to the layout below.
  return [
    c00 * d, c01 * d, c02 * d,
    (a02 * a21 - a01 * a22) * d, (a00 * a22 - a02 * a20) * d, (a01 * a20 - a00 * a21) * d,
    (a01 * a12 - a02 * a11) * d, (a02 * a10 - a00 * a12) * d, (a00 * a11 - a01 * a10) * d,
  ];
}

const transformNormal = (n, x, y, z) => {
  const out = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
  const len = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / len, out[1] / len, out[2] / len];
};

/**
 * Pulls one model out of a source GLB as `{ role -> { positions, normals,
 * indices } }`, compacted so each role carries only its own vertices.
 */
function extractParts(path, wantedRoles) {
  const { json, bin } = readGlb(path);
  const parts = new Map();
  const matrices = meshMatrices(json);
  let dropped = 0;

  for (let meshIndex = 0; meshIndex < json.meshes.length; meshIndex++) {
    const mesh = json.meshes[meshIndex];
    const world = matrices.get(meshIndex) ?? IDENTITY;
    const normals3 = normalMatrix(world);

    for (const primitive of mesh.primitives) {
      const material = json.materials?.[primitive.material]?.name ?? '';
      const role = roleOf(material);
      if (!role || !wantedRoles.includes(role)) continue;

      const srcPos = readAccessor(json, bin, primitive.attributes.POSITION);
      const srcNor = primitive.attributes.NORMAL !== undefined
        ? readAccessor(json, bin, primitive.attributes.NORMAL)
        : null;
      const srcIdx = readAccessor(json, bin, primitive.indices);

      // Compact: keep only vertices this primitive references, remapped.
      // Degenerate (zero-area) triangles are dropped on the way through —
      // `tree_oak` ships two in its bark primitive. They draw nothing, but they
      // carry vertices into the compacted buffer and skew a mesh's triangle
      // count, so pruning them is free.
      const remap = new Map();
      const positions = [];
      const normals = [];
      const indices = [];

      const at = (i) => [srcPos[i * 3], srcPos[i * 3 + 1], srcPos[i * 3 + 2]];
      const keep = [];
      for (let t = 0; t + 2 < srcIdx.length; t += 3) {
        const [a, b, c] = [at(srcIdx[t]), at(srcIdx[t + 1]), at(srcIdx[t + 2])];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const area = Math.hypot(
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        );
        if (area < 1e-12) {
          dropped += 1;
          continue;
        }
        keep.push(srcIdx[t], srcIdx[t + 1], srcIdx[t + 2]);
      }

      for (const oldIndex of keep) {
        let next = remap.get(oldIndex);
        if (next === undefined) {
          next = positions.length / 3;
          remap.set(oldIndex, next);
          positions.push(
            ...transformPoint(world, srcPos[oldIndex * 3], srcPos[oldIndex * 3 + 1], srcPos[oldIndex * 3 + 2]),
          );
          if (srcNor) {
            normals.push(
              ...transformNormal(normals3, srcNor[oldIndex * 3], srcNor[oldIndex * 3 + 1], srcNor[oldIndex * 3 + 2]),
            );
          }
        }
        indices.push(next);
      }

      // A role can appear as several primitives (palm fronds); merge them.
      const existing = parts.get(role);
      if (existing) {
        const offset = existing.positions.length / 3;
        existing.positions.push(...positions);
        existing.normals.push(...normals);
        existing.indices.push(...indices.map((i) => i + offset));
      } else {
        parts.set(role, { positions, normals, indices });
      }
    }
  }
  if (dropped > 0) console.log(`  (dropped ${dropped} degenerate triangle${dropped > 1 ? 's' : ''} from ${path.split('/').pop()})`);
  return parts;
}

/** Moves a whole model so its base sits at y = 0 and it is centred on XZ. */
function groundAndCentre(parts) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxZ = -Infinity;
  for (const part of parts.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      minX = Math.min(minX, part.positions[i]);
      maxX = Math.max(maxX, part.positions[i]);
      minY = Math.min(minY, part.positions[i + 1]);
      minZ = Math.min(minZ, part.positions[i + 2]);
      maxZ = Math.max(maxZ, part.positions[i + 2]);
    }
  }
  const dx = -(minX + maxX) / 2;
  const dz = -(minZ + maxZ) / 2;
  for (const part of parts.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      part.positions[i] += dx;
      part.positions[i + 1] -= minY;
      part.positions[i + 2] += dz;
    }
  }
}

/** Assembles named single-primitive meshes into one GLB. */
function writeGlb(models, outPath) {
  const json = {
    asset: { version: '2.0', generator: 'cozy-cove buildNatureKit' },
    scenes: [{ nodes: [] }],
    scene: 0,
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const blobs = [];
  let byteLength = 0;

  const pushView = (buffer, target) => {
    // glTF requires buffer views to start on a 4-byte boundary.
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      blobs.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length, target });
    blobs.push(buffer);
    byteLength += buffer.length;
    return json.bufferViews.length - 1;
  };

  for (const { name, positions, normals, indices } of models) {
    const count = positions.length / 3;
    if (count > 65535) throw new Error(`${name} needs 32-bit indices`);

    const posBuf = Buffer.alloc(positions.length * 4);
    positions.forEach((v, i) => posBuf.writeFloatLE(v, i * 4));
    const norBuf = Buffer.alloc(normals.length * 4);
    normals.forEach((v, i) => norBuf.writeFloatLE(v, i * 4));
    const idxBuf = Buffer.alloc(indices.length * 2);
    indices.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], positions[i + c]);
        max[c] = Math.max(max[c], positions[i + c]);
      }
    }

    const posAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(posBuf, 34962), componentType: FLOAT, count, type: 'VEC3', min, max,
    });
    const norAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(norBuf, 34962), componentType: FLOAT, count, type: 'VEC3',
    });
    const idxAccessor = json.accessors.length;
    json.accessors.push({
      bufferView: pushView(idxBuf, 34963), componentType: USHORT, count: indices.length, type: 'SCALAR',
    });

    // Name the mesh and the node identically: three's GLTFLoader may take
    // either as `mesh.name`, and `extractGeometries` keys on that name.
    json.meshes.push({
      name,
      primitives: [{ mode: 4, indices: idxAccessor, attributes: { POSITION: posAccessor, NORMAL: norAccessor } }],
    });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }

  const bin = Buffer.concat(blobs);
  json.buffers.push({ byteLength: bin.length });

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  const binPad = bin.length % 4 ? Buffer.alloc(4 - (bin.length % 4)) : Buffer.alloc(0);
  const binBuf = Buffer.concat([bin, binPad]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);

  const chunk = (buf, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(buf.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, buf]);
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([header, chunk(jsonBuf, CHUNK_JSON), chunk(binBuf, CHUNK_BIN)]));
}

const kitDir = process.argv[2];
const outPath = process.argv[3] ?? 'public/assets/models/nature/nature.glb';
if (!kitDir) {
  console.error('usage: node tools/buildNatureKit.mjs <kenney_nature-kit/Models/GLTF format> [out.glb]');
  process.exit(1);
}

const models = [];
for (const source of SOURCES) {
  const parts = extractParts(join(kitDir, `${source.file}.glb`), source.roles);
  for (const role of source.roles) {
    if (!parts.has(role)) throw new Error(`${source.file}: no primitive with role "${role}"`);
  }
  groundAndCentre(parts);
  for (const [role, part] of parts) {
    models.push({ name: role === 'whole' ? source.file : `${source.file}_${role}`, ...part });
  }
}

writeGlb(models, outPath);

const total = models.reduce(
  (acc, m) => ({ v: acc.v + m.positions.length / 3, t: acc.t + m.indices.length / 3 }),
  { v: 0, t: 0 },
);
console.log(`${outPath} — ${models.length} nodes, ${total.v} verts, ${total.t} tris`);
for (const m of models) {
  console.log(`  ${m.name.padEnd(28)} ${String(m.positions.length / 3).padStart(5)} verts  ${String(m.indices.length / 3).padStart(5)} tris`);
}
