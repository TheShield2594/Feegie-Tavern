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
 *    kit are never opened.
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
  { file: 'tree_palmShort', roles: ['trunk', 'canopy'] },
  { file: 'plant_bush', roles: ['whole'] },
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

/** Node-local translation/scale, applied so the exported geometry needs none. */
function nodeTransform(json, meshIndex) {
  const node = json.nodes.find((n) => n.mesh === meshIndex);
  return {
    t: node?.translation ?? [0, 0, 0],
    s: node?.scale ?? [1, 1, 1],
  };
}

/**
 * Pulls one model out of a source GLB as `{ role -> { positions, normals,
 * indices } }`, compacted so each role carries only its own vertices.
 */
function extractParts(path, wantedRoles) {
  const { json, bin } = readGlb(path);
  const parts = new Map();

  for (let meshIndex = 0; meshIndex < json.meshes.length; meshIndex++) {
    const mesh = json.meshes[meshIndex];
    const { t, s } = nodeTransform(json, meshIndex);

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
      const remap = new Map();
      const positions = [];
      const normals = [];
      const indices = [];
      for (const oldIndex of srcIdx) {
        let next = remap.get(oldIndex);
        if (next === undefined) {
          next = positions.length / 3;
          remap.set(oldIndex, next);
          positions.push(
            srcPos[oldIndex * 3] * s[0] + t[0],
            srcPos[oldIndex * 3 + 1] * s[1] + t[1],
            srcPos[oldIndex * 3 + 2] * s[2] + t[2],
          );
          if (srcNor) normals.push(srcNor[oldIndex * 3], srcNor[oldIndex * 3 + 1], srcNor[oldIndex * 3 + 2]);
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
