/**
 * Builds `public/assets/models/nature/nature.glb` from the Kenney Nature Kit.
 *
 *   node tools/buildKit.mjs <kit> <unzipped-kit-root> [out.glb]
 *   npm run assets:build-kit -- nature ./kenney_nature-kit
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
import { inflateSync } from 'node:zlib';
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

/** Nature Kit models the game places, and which material roles to keep. */
const NATURE_SOURCES = [
  { file: 'tree_default', roles: ['trunk', 'canopy'] },
  { file: 'tree_oak', roles: ['trunk', 'canopy'] },
  { file: 'tree_pineDefaultA', roles: ['trunk', 'canopy'] },
  // A tall palm rather than `tree_palmShort`: the short one had to be scaled
  // x5.7 to reach the height the procedural palm occupied, which made its trunk
  // read far thicker than every other tree's. This one needs roughly half that.
  // It is also the model that requires the transform composition below, since
  // its fronds are rotated child nodes.
  { file: 'tree_palmDetailedTall', roles: ['trunk', 'canopy'] },
  // `plant_bushDetailed` over `plant_bush`: the procedural bush it replaces is
  // a wide blob, and the plain one is a sparse few leaves that left ground
  // cover looking thin.
  { file: 'plant_bushDetailed', roles: ['whole'] },
  { file: 'plant_bushLarge', roles: ['whole'] },
];

/**
 * The kits this script knows how to build, and the models taken from each.
 *
 * Kept deliberately small per kit: ASSET_PLAN §5 step 1 is "import only the
 * models actually placed — not all 330".
 *
 * `mode` picks how a model's colour survives the trip:
 *
 *  - `split-by-material` — the source has one flat `baseColorFactor` per
 *    material, so each material becomes its own node and the game binds a
 *    palette material to it. Trunk and canopy stay independently tintable.
 *  - `bake-materials` — the source uses flat `baseColorFactor` materials but a
 *    model mixes several of them (a cabinet is wood + woodDark + metal), and the
 *    object is one thing the game places as a unit. Each primitive's colour is
 *    written to its vertices, giving one node per model rather than one per
 *    material.
 *  - `bake-atlas` — the source shares one textured atlas across every model,
 *    with no discrete material roles to split on, so the atlas is sampled into
 *    COLOR_0 per vertex and dropped. The manifest entry sets
 *    `keepVertexColors: true` and the game renders it with
 *    `createStylizedMaterial({ vertexColors: true })`.
 */
const KITS = {
  nature: {
    dir: 'Models/GLTF format',
    out: 'public/assets/models/nature/nature.glb',
    mode: 'split-by-material',
    sources: NATURE_SOURCES,
  },
  town: {
    dir: 'Models/GLB format',
    out: 'public/assets/models/buildings/buildings.glb',
    mode: 'bake-atlas',
    atlas: 'Models/GLB format/Textures/colormap.png',
    // Modular pieces snap to a 1x1 grid, and the authored origin *is* the snap
    // point: `wall` spans x 0.40..0.50, sitting on its tile's edge so four of
    // them enclose a room. Grounding and centring each piece the way a tree
    // needs would move that wall to x -0.05..0.05 — the tile's middle — and the
    // four walls would collapse into a post instead of a room. Origins are left
    // exactly as authored.
    preserveOrigin: true,
    // Buildings, homes and the paths between them: a modular shell (walls,
    // roofs, a doorway, a shuttered window, a chimney), the road pieces that
    // dress `heightfield`'s PATHS, and the fences, hedges, steps and lamps that
    // edge them.
    sources: [
      'road', 'road-bend', 'road-corner', 'road-edge', 'road-curb',
      'wall', 'wall-corner', 'wall-doorway-square', 'wall-window-shutters',
      'wall-wood', 'wall-wood-corner',
      'roof-gable', 'roof-gable-end', 'roof-gable-top', 'roof-corner', 'roof-flat',
      'chimney', 'fence', 'fence-gate', 'hedge', 'hedge-gate', 'stairs-stone', 'lantern',
    ].map((file) => ({ file, roles: ['whole'] })),
  },

  furniture: {
    dir: 'Models/GLTF format',
    out: 'public/assets/models/furniture/furniture.glb',
    // Flat materials like the Nature Kit, but split-by-material is wrong here:
    // a tree wants its trunk and canopy tinted independently, whereas a cabinet
    // is one object the player places and rotates as a unit. Baking wood /
    // woodDark / metal into its vertices keeps it one node.
    mode: 'bake-materials',
    // One per kind in `housing/FurnitureModels.ts` — sofa, table, lamp, rug,
    // music, plant, shelf, bed, chair — plus a second option for the kinds a
    // room wants more than one of.
    sources: [
      'loungeSofa', 'loungeSofaLong',
      'table', 'tableCoffee',
      'lampRoundTable', 'lampRoundFloor',
      'rugRectangle', 'rugRound',
      'radio', 'televisionVintage',
      'pottedPlant', 'plantSmall1',
      'bookcaseOpen', 'bookcaseClosedWide',
      'bedSingle', 'bedDouble',
      'chair', 'chairCushion',
      'stoolBar', 'desk',
    ].map((file) => ({ file, roles: ['whole'] })),
  },

  items: {
    dir: 'Models/GLB format',
    out: 'public/assets/models/items/items.glb',
    mode: 'bake-atlas',
    atlas: 'Models/GLB format/Textures/colormap.png',
    // Mapped onto the kinds `items/ItemModels.ts` draws by hand. The Food Kit
    // covers the edible half — berry, gourd, root, dish, seed — and nothing
    // else: the insects, shells, bones and rays in that switch have no source
    // in §3 at all, which §9.5j records rather than papering over.
    sources: [
      'carrot', 'cabbage', 'corn', 'tomato', 'pumpkin',
      'apple', 'strawberry',
      'bread', 'cheese', 'egg-cooked', 'sandwich', 'pie', 'cake',
      'bowl-soup', 'plate-dinner', 'sushi-salmon',
    ].map((file) => ({ file, roles: ['whole'] })),
  },

  props: {
    dir: 'Models/GLB format',
    out: 'public/assets/models/props/props.glb',
    mode: 'bake-atlas',
    atlas: 'Models/GLB format/Textures/colormap.png',
    // Standalone objects rather than grid modules, so unlike the town kit these
    // *do* want grounding and centring: each is placed on its own by
    // `world/Props.ts` or held by `player/Tools.ts`, and nothing snaps to
    // anything. (They ship grounded already; centring nudges the asymmetric
    // rocks onto their own axis.)
    sources: [
      // Scatter rocks — Props.buildRocks instances these across the meadows.
      'rock-a', 'rock-b', 'rock-c',
      // Town, harbour and beach dressing.
      'barrel', 'box', 'chest', 'bucket', 'campfire-pit', 'signpost', 'tent', 'tree-log',
      // Gatherable resource drops.
      'resource-wood', 'resource-stone',
      // player/Tools.ts — the kit also ships `-upgraded` variants, which map
      // onto the game's existing tool levels whenever that is wired.
      'tool-axe', 'tool-pickaxe', 'tool-shovel', 'tool-hoe',
      // Kenney's own fish. See ASSET_PLAN §9.5h: the fish slice item is blocked
      // on Quaternius' download host, and this comes from a pack §3 already
      // approves, so it is carried here as the unblocking option.
      //
      // `fish-large` is deliberately NOT included: it is the same mesh at
      // exactly 1.5x, so shipping it would duplicate 593 vertices to express
      // what `normalize.scale` already expresses for free.
      'fish',
    ].map((file) => ({ file, roles: ['whole'] })),
  },
};

/** Splits a GLB into its JSON chunk and its binary chunk. */
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

/** Byte width of each glTF component type. */
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Reads an accessor out of the BIN chunk into a plain array of numbers.
 *
 * Handles every integer width and honours `byteStride`, neither of which the
 * Nature Kit needed: it is uniformly float data with UINT32 indices and tightly
 * packed views. The Fantasy Town Kit is not — its meshes are small enough that
 * it indexes them with UNSIGNED_BYTE, which a USHORT-only reader walks straight
 * off the end of the buffer.
 */
function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const size = COMPONENT_BYTES[accessor.componentType];
  if (!size) throw new Error(`unsupported componentType ${accessor.componentType}`);
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride || components * size;
  const out = new Array(accessor.count * components);

  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const at = base + i * stride + c * size;
      const value =
        accessor.componentType === 5126 ? bin.readFloatLE(at)
        : accessor.componentType === 5125 ? bin.readUInt32LE(at)
        : accessor.componentType === 5123 ? bin.readUInt16LE(at)
        : accessor.componentType === 5121 ? bin.readUInt8(at)
        : accessor.componentType === 5122 ? bin.readInt16LE(at)
        : bin.readInt8(at);
      out[i * components + c] = value;
    }
  }
  return out;
}

// --- colour atlas ----------------------------------------------------------
//
// The Fantasy Town Kit is textured where the Nature Kit is not: all 167 models
// share one 512x512 `colormap.png`. It is not a flat-swatch palette — sampling
// it shows 40-60 slightly different shades per model, because Kenney authors
// these as gradient ramps. That rules out splitting a model by atlas colour the
// way the nature trees split by material: there are no discrete roles to split
// on, only a smooth ramp.
//
// So the atlas is baked into COLOR_0 per vertex and thrown away. The look is
// preserved, no texture ships at all (no KTX2 step, no second request), and the
// result is exactly what `NormalizeOptions.keepVertexColors` was written for:
// "Kits that bake several colours into one mesh need this".

/**
 * sRGB byte to linear float.
 *
 * glTF is explicit that `COLOR_0` holds **linear** values, while a
 * `baseColorTexture` holds **sRGB** ones. Baking a texture into vertex colours
 * therefore has to decode: copying the raw bytes across skips the sRGB→linear
 * step the renderer would have done when sampling the texture, and every
 * surface comes out washed out and too bright. `baseColorFactor`, by contrast,
 * is already linear and goes straight through.
 */
function srgbToLinear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Decodes an 8-bit RGB/RGBA PNG. Enough for Kenney's colormap. */
function decodePng(path) {
  const d = readFileSync(path);
  let i = 8;
  let width = 0, height = 0, depth = 0, colourType = 0;
  const idat = [];
  let palette = null;
  while (i < d.length) {
    const length = d.readUInt32BE(i);
    const type = d.toString('ascii', i + 4, i + 8);
    if (type === 'IHDR') {
      width = d.readUInt32BE(i + 8); height = d.readUInt32BE(i + 12);
      depth = d[i + 16]; colourType = d[i + 17];
    } else if (type === 'PLTE') palette = Buffer.from(d.subarray(i + 8, i + 8 + length));
    else if (type === 'IDAT') idat.push(d.subarray(i + 8, i + 8 + length));
    i += 12 + length;
  }
  // Colour type 3 is an indexed palette — which is how the Survival Kit ships
  // its colormap, where the Fantasy Town Kit ships truecolour. Both are flat
  // palettes; only the encoding differs.
  if (depth !== 8 || ![2, 3, 6].includes(colourType)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType}): ${path}`);
  }
  if (colourType === 3 && !palette) throw new Error(`indexed PNG with no PLTE chunk: ${path}`);

  const channels = colourType === 6 ? 4 : colourType === 3 ? 1 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < width; x++) {
      if (colourType === 3) {
        const entry = line[x] * 3;
        out[(y * width + x) * 3] = palette[entry];
        out[(y * width + x) * 3 + 1] = palette[entry + 1];
        out[(y * width + x) * 3 + 2] = palette[entry + 2];
      } else {
        out[(y * width + x) * 3] = line[x * channels];
        out[(y * width + x) * 3 + 1] = line[x * channels + 1];
        out[(y * width + x) * 3 + 2] = line[x * channels + 2];
      }
    }
    prev = line;
  }
  return { width, height, rgb: out };
}

/**
 * Nearest-neighbour sample, returned linear. The ramps are smooth, so filtering
 * buys nothing.
 */
function sampleAtlas(image, u, v) {
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
  const at = (y * image.width + x) * 3;
  return [srgbToLinear(image.rgb[at]), srgbToLinear(image.rgb[at + 1]), srgbToLinear(image.rgb[at + 2])];
}

/**
 * Which part of a model a material belongs to — trunk, canopy and so on.
 *
 * Keyed on the material name rather than the primitive index because Kenney's
 * ordering is not consistent between models, and indexing by position silently
 * swapped bark for leaves on some trees.
 */
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

/** Column-major 4x4 product, so a node's transform chain composes correctly. */
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

/** Applies a 4x4 to a position, translation included. */
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

/** Applies a normal matrix to a normal and renormalises it. */
const transformNormal = (n, x, y, z) => {
  const out = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
  const len = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / len, out[1] / len, out[2] / len];
};

/**
 * Pulls one model out of a source GLB as `{ role -> { positions, normals,
 * indices } }`, compacted so each role carries only its own vertices.
 */
function extractParts(path, wantedRoles, atlas = null, bakeMaterials = false) {
  const { json, bin } = readGlb(path);
  const parts = new Map();
  const matrices = meshMatrices(json);
  let dropped = 0;

  for (let meshIndex = 0; meshIndex < json.meshes.length; meshIndex++) {
    const mesh = json.meshes[meshIndex];
    const world = matrices.get(meshIndex) ?? IDENTITY;
    const normals3 = normalMatrix(world);

    for (const primitive of mesh.primitives) {
      // A baked-atlas kit has one material for everything, so there is no role
      // to read off it — the whole model is one part.
      const material = json.materials?.[primitive.material]?.name ?? '';
      const role = atlas || bakeMaterials ? 'whole' : roleOf(material);
      if (!role || !wantedRoles.includes(role)) continue;

      const srcPos = readAccessor(json, bin, primitive.attributes.POSITION);
      const srcNor = primitive.attributes.NORMAL !== undefined
        ? readAccessor(json, bin, primitive.attributes.NORMAL)
        : null;
      const srcUv = atlas && primitive.attributes.TEXCOORD_0 !== undefined
        ? readAccessor(json, bin, primitive.attributes.TEXCOORD_0)
        : null;
      // `baseColorFactor` is already linear, so unlike the atlas it needs no
      // decode — it is the value COLOR_0 wants.
      const flat = bakeMaterials
        ? (json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1])
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
      const colors = [];
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
          // Sampled per vertex at its own UV, which is exactly what the texture
          // lookup would return there; interpolation across the triangle then
          // reproduces the ramp.
          if (srcUv) colors.push(...sampleAtlas(atlas, srcUv[oldIndex * 2], srcUv[oldIndex * 2 + 1]));
          else if (flat) colors.push(flat[0], flat[1], flat[2]);
        }
        indices.push(next);
      }

      // A role can appear as several primitives (palm fronds); merge them.
      const existing = parts.get(role);
      if (existing) {
        const offset = existing.positions.length / 3;
        existing.positions.push(...positions);
        existing.normals.push(...normals);
        existing.colors.push(...colors);
        existing.indices.push(...indices.map((i) => i + offset));
      } else {
        parts.set(role, { positions, normals, colors, indices });
      }
    }
  }
  if (dropped > 0) console.log(`  (dropped ${dropped} degenerate triangle${dropped > 1 ? 's' : ''} from ${path.split('/').pop()})`);
  return parts;
}

/**
 * Confirms a modular piece came through with its authored bounds intact.
 *
 * Kenney's town pieces snap to a 1x1 grid and the origin is the snap point:
 * `wall` spans x 0.40..0.50, sitting on its tile's edge so four of them enclose
 * a room. Centring it — correct for a tree, wrong for a wall — moves it to
 * x -0.05..0.05 and four walls collapse into a post.
 */
function assertOriginPreserved(name, sourcePath, parts) {
  const { json } = readGlb(sourcePath);
  const matrices = meshMatrices(json);
  const source = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  for (let meshIndex = 0; meshIndex < json.meshes.length; meshIndex++) {
    const world = matrices.get(meshIndex) ?? IDENTITY;
    for (const primitive of json.meshes[meshIndex].primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      // The accessor's min/max are in the mesh's own space. Comparing them
      // against post-transform output would flag any model with a moved child
      // node — `fence-gate` swings its gate panel — so the eight corners of the
      // source box go through the same world matrix the build applies.
      for (let corner = 0; corner < 8; corner++) {
        const local = [
          corner & 1 ? accessor.max[0] : accessor.min[0],
          corner & 2 ? accessor.max[1] : accessor.min[1],
          corner & 4 ? accessor.max[2] : accessor.min[2],
        ];
        const world3 = transformPoint(world, local[0], local[1], local[2]);
        for (let c = 0; c < 3; c++) {
          source.min[c] = Math.min(source.min[c], world3[c]);
          source.max[c] = Math.max(source.max[c], world3[c]);
        }
      }
    }
  }

  const built = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const part of parts.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        built.min[c] = Math.min(built.min[c], part.positions[i + c]);
        built.max[c] = Math.max(built.max[c], part.positions[i + c]);
      }
    }
  }

  for (let c = 0; c < 3; c++) {
    if (Math.abs(source.min[c] - built.min[c]) > 2e-3 || Math.abs(source.max[c] - built.max[c]) > 2e-3) {
      throw new Error(
        `${name}: origin not preserved on axis ${'xyz'[c]} — ` +
          `source [${source.min[c].toFixed(3)}, ${source.max[c].toFixed(3)}] ` +
          `built [${built.min[c].toFixed(3)}, ${built.max[c].toFixed(3)}]`,
      );
    }
  }
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

  for (const { name, positions, normals, colors, indices } of models) {
    const count = positions.length / 3;
    if (count > 65535) throw new Error(`${name} needs 32-bit indices`);
    // A source primitive with no NORMAL leaves `normals` empty, but the
    // accessor below is still declared at the full vertex count — that writes a
    // structurally invalid GLB which only fails later, in the validator. Stop
    // at the source model instead.
    if (normals.length !== positions.length) {
      throw new Error(`${name}: missing NORMAL data (${normals.length / 3} of ${count} vertices)`);
    }

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

    // COLOR_0 as normalised unsigned bytes: a quarter the size of float32 and
    // visually identical for 8-bit source colours. VEC4 rather than VEC3 so
    // each element stays 4-byte aligned, as the spec requires.
    let colAccessor = null;
    if (colors && colors.length === positions.length) {
      const colBuf = Buffer.alloc(count * 4);
      const quantise = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
      for (let i = 0; i < count; i++) {
        colBuf[i * 4] = quantise(colors[i * 3]);
        colBuf[i * 4 + 1] = quantise(colors[i * 3 + 1]);
        colBuf[i * 4 + 2] = quantise(colors[i * 3 + 2]);
        colBuf[i * 4 + 3] = 255;
      }
      colAccessor = json.accessors.length;
      json.accessors.push({
        bufferView: pushView(colBuf, 34962), componentType: 5121, normalized: true, count, type: 'VEC4',
      });
    }

    // Name the mesh and the node identically: three's GLTFLoader may take
    // either as `mesh.name`, and `extractGeometries` keys on that name.
    const attributes = { POSITION: posAccessor, NORMAL: norAccessor };
    if (colAccessor !== null) attributes.COLOR_0 = colAccessor;
    json.meshes.push({ name, primitives: [{ mode: 4, indices: idxAccessor, attributes }] });
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

const kitName = process.argv[2];
const kitRoot = process.argv[3];
const kit = KITS[kitName];
if (!kit || !kitRoot) {
  console.error(`usage: node tools/buildKit.mjs <${Object.keys(KITS).join('|')}> <unzipped-kit-root> [out.glb]`);
  process.exit(1);
}
const outPath = process.argv[4] ?? kit.out;
const sourceDir = join(kitRoot, kit.dir);
const atlas = kit.atlas ? decodePng(join(kitRoot, kit.atlas)) : null;
if (atlas) console.log(`atlas ${kit.atlas} — ${atlas.width}x${atlas.height}, baked to COLOR_0 and dropped`);

const models = [];
for (const source of kit.sources) {
  const parts = extractParts(join(sourceDir, `${source.file}.glb`), source.roles, atlas, kit.mode === 'bake-materials');
  for (const role of source.roles) {
    if (!parts.has(role)) throw new Error(`${source.file}: no primitive with role "${role}"`);
  }
  if (kit.preserveOrigin) {
    // The whole point of preserveOrigin is that nothing moved. Assert it here
    // rather than trusting it: this is the only place that can see both the
    // source file and the result, and a piece that quietly drifted to the
    // centre of its tile still passes every structural check downstream.
    assertOriginPreserved(source.file, join(sourceDir, `${source.file}.glb`), parts);
  } else {
    groundAndCentre(parts);
  }
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
