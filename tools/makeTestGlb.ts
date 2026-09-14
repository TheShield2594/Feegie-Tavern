/**
 * Builds a small glTF-binary by hand, so the import pipeline can be exercised
 * without downloading a real kit.
 *
 * It deliberately reproduces the two things kit GLBs do that naive importers
 * get wrong: meshes nested under a transformed parent node, and a model whose
 * origin is not at its base.
 */
import { Buffer } from 'node:buffer';

interface Prim {
  name: string;
  /** Non-indexed triangle soup, xyz per vertex. */
  positions: number[];
}

/** Axis-aligned box as 12 triangles, min/max in local space. */
function box(min: [number, number, number], max: [number, number, number]): number[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
    [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
    [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
  ];
  return faces.flatMap((f) => f.flatMap((i) => v[i]));
}

export interface TestGlbOptions {
  /** Translation applied to the parent node, to prove world matrices are baked. */
  parentTranslation?: [number, number, number];
  /** Uniform scale on the parent node. */
  parentScale?: number;
}

/**
 * Builds a two-mesh GLB in memory for `assets:verify`.
 *
 * A trunk raised off the floor and a canopy offset in X, both under a
 * translated and scaled parent — the arrangement that catches an importer
 * which ignores world matrices, or which grounds every node separately.
 */
export function buildTestGlb(options: TestGlbOptions = {}): Buffer {
  const { parentTranslation = [10, 5, -3], parentScale = 2 } = options;

  const prims: Prim[] = [
    // Trunk: sits from y=0.5 to y=2 so `groundOrigin` has something to correct.
    { name: 'tree_trunk', positions: box([-0.2, 0.5, -0.2], [0.2, 2, 0.2]) },
    // Canopy: offset on X too, so `centreXZ` is observable.
    { name: 'tree_canopy', positions: box([0.6, 2, -1], [2.6, 4, 1]) },
  ];

  const chunks: Buffer[] = [];
  const accessors: unknown[] = [];
  const bufferViews: unknown[] = [];
  const meshes: unknown[] = [];
  const nodes: unknown[] = [];
  let offset = 0;

  prims.forEach((prim, i) => {
    const data = Buffer.from(new Float32Array(prim.positions).buffer);
    // glTF requires 4-byte alignment for buffer views.
    const padding = (4 - (data.length % 4)) % 4;
    const padded = Buffer.concat([data, Buffer.alloc(padding)]);
    chunks.push(padded);

    const count = prim.positions.length / 3;
    const xs = prim.positions.filter((_, k) => k % 3 === 0);
    const ys = prim.positions.filter((_, k) => k % 3 === 1);
    const zs = prim.positions.filter((_, k) => k % 3 === 2);

    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target: 34962 });
    accessors.push({
      bufferView: i,
      componentType: 5126, // FLOAT
      count,
      type: 'VEC3',
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    });
    meshes.push({ name: prim.name, primitives: [{ attributes: { POSITION: i }, mode: 4 }] });
    nodes.push({ name: prim.name, mesh: i });

    offset += padded.length;
  });

  // Parent node carrying a translation and scale the importer must bake.
  nodes.push({
    name: 'tree_root',
    translation: parentTranslation,
    scale: [parentScale, parentScale, parentScale],
    children: prims.map((_, i) => i),
  });

  const json = {
    asset: { version: '2.0', generator: 'cozy-cove test fixture' },
    scene: 0,
    scenes: [{ nodes: [prims.length] }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const bin = Buffer.concat(chunks);
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + bin.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPad.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN"

  return Buffer.concat([header, jsonHeader, jsonPad, binHeader, bin]);
}
