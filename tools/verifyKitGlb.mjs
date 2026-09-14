/**
 * Validates a built kit GLB — the real file, not a fixture.
 *
 *   npm run assets:verify-kit -- public/assets/models/nature/nature.glb
 *   npm run assets:verify-kit -- public/assets/models/buildings/buildings.glb --modular
 *
 * `assets:verify` covers the *import path* (`gltfImport` against a synthetic
 * glTF), and needs three. This covers the *artefact* `buildKit.mjs`
 * produces, and needs nothing: it parses the GLB itself, so it runs in any
 * environment that has node.
 *
 * The checks are the ones whose failures are silent rather than loud. A GLB
 * with a bad accessor `min`/`max` still loads and then culls wrongly at
 * distance; an index past the end of the vertex buffer may render fine until a
 * driver decides otherwise; a canopy grounded independently of its trunk passes
 * every structural test and simply looks wrong. Normals get their own check
 * because the build script transforms them by the inverse transpose of each
 * node's matrix — under the non-uniform scale on the palm's fronds, getting
 * that wrong denormalises them and skews the lighting without breaking
 * anything visible in the file's structure.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
// Modular kits snap to a grid, so their authored origins are load-bearing and
// must NOT be grounded or centred — the opposite of a kit of standalone props.
const modular = args.includes('--modular');
const file = args.find((a) => !a.startsWith('--')) ?? 'public/assets/models/nature/nature.glb';
const buf = readFileSync(file);

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

// --- container -------------------------------------------------------------

check('GLB magic', buf.readUInt32LE(0) === 0x46546c67);
check('GLB version 2', buf.readUInt32LE(4) === 2);
check('header length matches file', buf.readUInt32LE(8) === buf.length, `${buf.readUInt32LE(8)} vs ${buf.length}`);

let offset = 12;
let json = null;
let bin = null;
let chunks = 0;
while (offset + 8 <= buf.length) {
  const length = buf.readUInt32LE(offset);
  const type = buf.readUInt32LE(offset + 4);
  check(`chunk ${chunks} length is 4-aligned`, length % 4 === 0, `len=${length}`);
  const data = buf.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004e4942) bin = Buffer.from(data);
  offset += 8 + length;
  chunks += 1;
}
check('exactly two chunks (JSON + BIN)', chunks === 2, `got ${chunks}`);
if (!json || !bin) {
  console.log('\nunparseable — stopping.');
  process.exit(1);
}

// --- structure the loader and the manifest rely on -------------------------

const names = json.nodes.map((n) => n.name);
check('node names are unique', new Set(names).size === names.length);
check('every node has a mesh', json.nodes.every((n) => n.mesh !== undefined));
check('every mesh has exactly one primitive', json.meshes.every((m) => m.primitives.length === 1));
// extractGeometries keys on mesh.name, falling back to the parent node's name;
// keeping them equal means the manifest's `node` matches either way.
check('mesh name equals node name', json.nodes.every((n) => json.meshes[n.mesh].name === n.name));
check('scene lists every node', json.scenes[0].nodes.length === json.nodes.length);
check('buffer fits inside the BIN chunk', json.buffers[0].byteLength <= bin.length);
check('all bufferViews are 4-aligned', json.bufferViews.every((v) => (v.byteOffset ?? 0) % 4 === 0));
check(
  'all bufferViews lie inside the buffer',
  json.bufferViews.every((v) => (v.byteOffset ?? 0) + v.byteLength <= bin.length),
);

// The pipeline strips these on purpose: the palette supplies colour, and the
// wind shader derives stiffness from position rather than UV.
check('no materials shipped', !json.materials);
check('no textures or images shipped', !json.images && !json.textures);
check('no UVs shipped', json.meshes.every((m) => !('TEXCOORD_0' in m.primitives[0].attributes)));

// A baked-atlas kit carries its colour per vertex instead of in a texture. It
// is all-or-nothing: a kit where only some nodes kept their colour would render
// the rest black under `vertexColors: true`.
const coloured = json.meshes.filter((m) => 'COLOR_0' in m.primitives[0].attributes);
check(
  'vertex colours are all-or-nothing',
  coloured.length === 0 || coloured.length === json.meshes.length,
  `${coloured.length}/${json.meshes.length} nodes have COLOR_0`,
);
if (coloured.length > 0) {
  check(
    'COLOR_0 is normalised UNSIGNED_BYTE VEC4',
    coloured.every((m) => {
      const a = json.accessors[m.primitives[0].attributes.COLOR_0];
      return a.componentType === 5121 && a.normalized === true && a.type === 'VEC4';
    }),
  );
}
check('indices narrowed to UINT16', json.meshes.every((m) => json.accessors[m.primitives[0].indices].componentType === 5123));

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < accessor.count * components; i++) {
    if (accessor.componentType === 5126) out.push(bin.readFloatLE(base + i * 4));
    else if (accessor.componentType === 5123) out.push(bin.readUInt16LE(base + i * 2));
    else if (accessor.componentType === 5125) out.push(bin.readUInt32LE(base + i * 4));
  }
  return out;
}

// --- per node --------------------------------------------------------------

console.log('');
const boxes = new Map();
let totalVerts = 0;
let totalTris = 0;

for (const node of json.nodes) {
  const primitive = json.meshes[node.mesh].primitives[0];
  const positions = readAccessor(primitive.attributes.POSITION);
  const normals = readAccessor(primitive.attributes.NORMAL);
  const indices = readAccessor(primitive.indices);
  const count = positions.length / 3;
  totalVerts += count;
  totalTris += indices.length / 3;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[i + c]);
      max[c] = Math.max(max[c], positions[i + c]);
    }
  }
  boxes.set(node.name, { min, max });

  const declared = json.accessors[primitive.attributes.POSITION];
  const boundsOk =
    declared.min.every((v, c) => Math.abs(v - min[c]) < 1e-5) &&
    declared.max.every((v, c) => Math.abs(v - max[c]) < 1e-5);

  // Denormalised normals mean the node's normal matrix was built wrongly.
  let worstNormal = 0;
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    worstNormal = Math.max(worstNormal, Math.abs(length - 1));
  }

  let degenerate = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    if (Math.hypot(...cross) < 1e-12) degenerate += 1;
  }

  check(
    `${node.name}: indices, bounds, normals, triangles`,
    indices.every((i) => i < count) &&
      indices.length % 3 === 0 &&
      boundsOk &&
      normals.length === positions.length &&
      worstNormal < 1e-3 &&
      degenerate === 0,
    `${count}v ${indices.length / 3}t  bounds=${boundsOk ? 'ok' : 'WRONG'} |n|err=${worstNormal.toExponential(1)} degenerate=${degenerate}`,
  );
}

// --- per model (trunk + canopy move together) ------------------------------

console.log('');
const models = new Map();
for (const name of names) {
  const base = name.replace(/_(trunk|canopy)$/, '');
  if (!models.has(base)) models.set(base, []);
  models.get(base).push(name);
}

for (const [model, parts] of models) {
  const minY = Math.min(...parts.map((p) => boxes.get(p).min[1]));
  const centreX = (Math.min(...parts.map((p) => boxes.get(p).min[0])) + Math.max(...parts.map((p) => boxes.get(p).max[0]))) / 2;
  const centreZ = (Math.min(...parts.map((p) => boxes.get(p).min[2])) + Math.max(...parts.map((p) => boxes.get(p).max[2]))) / 2;

  if (modular) {
    // The authored origin is the contract here, so there is nothing to assert
    // about grounding or centring — that a piece's origin survived the build is
    // checked by buildKit.mjs, which is the thing that can see the source.
    //
    // Two invariants still hold and are worth guarding. A piece occupies a
    // whole number of grid cells (Kenney authors multi-cell pieces: `road-bend`
    // is a 3x3 curve), and it stays near the origin — a stray transform would
    // show up as a piece flung cells away from its own tile.
    const width = Math.max(...parts.map((p) => boxes.get(p).max[0])) - Math.min(...parts.map((p) => boxes.get(p).min[0]));
    const depth = Math.max(...parts.map((p) => boxes.get(p).max[2])) - Math.min(...parts.map((p) => boxes.get(p).min[2]));
    const centreOk = Math.abs(centreX) < 2 && Math.abs(centreZ) < 2 && Math.abs(minY) < 2;
    check(
      `${model}: ${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(depth))} cells, anchored near its tile`,
      centreOk && width < 4 && depth < 4,
      `${width.toFixed(2)} x ${depth.toFixed(2)}, centre (${centreX.toFixed(2)}, ${centreZ.toFixed(2)}), minY ${minY.toFixed(3)}`,
    );
    continue;
  }

  check(`${model}: base sits at y=0`, Math.abs(minY) < 1e-5, `minY=${minY.toExponential(1)}`);
  check(`${model}: centred on XZ`, Math.abs(centreX) < 1e-5 && Math.abs(centreZ) < 1e-5, `(${centreX.toExponential(1)}, ${centreZ.toExponential(1)})`);

  if (parts.length === 2) {
    const trunk = boxes.get(`${model}_trunk`);
    const canopy = boxes.get(`${model}_canopy`);
    // Grounding each part separately would drop the canopy to y=0 and take the
    // tree apart; this is the check that catches it.
    // The detail string is an argument, so it is built before `check` runs: a
    // two-part group that is not a trunk/canopy pair would throw a TypeError
    // here instead of reporting a failed check.
    check(
      `${model}: canopy rides above the trunk base`,
      Boolean(canopy && trunk && canopy.max[1] > trunk.max[1] * 0.9 && canopy.min[1] > 1e-4),
      canopy && trunk
        ? `canopy y=[${canopy.min[1].toFixed(2)}, ${canopy.max[1].toFixed(2)}] trunk top=${trunk.max[1].toFixed(2)}`
        : `expected ${model}_trunk and ${model}_canopy, got ${parts.join(', ')}`,
    );
  }
}

console.log(
  failures === 0
    ? `\nAll kit checks passed — ${json.nodes.length} nodes, ${totalVerts} verts, ${totalTris} tris, ${(buf.length / 1024).toFixed(1)} KB.`
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
