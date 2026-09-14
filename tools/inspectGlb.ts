/**
 * Prints the node names inside a GLB, so `src/assets/manifest.ts` can be filled
 * in from what a pack actually contains rather than from guesswork.
 *
 *   npm run assets:inspect -- public/assets/models/nature/nature.glb
 */
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { extractGeometries, geometryStats } from '../src/assets/gltfImport';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run assets:inspect -- <file.glb>');
  process.exit(1);
}

const buffer = readFileSync(file);
const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(
  array as ArrayBuffer,
  '',
  (gltf) => {
    const geometries = extractGeometries(gltf.scene);
    let vertices = 0;
    let triangles = 0;

    const rows = [...geometries.entries()]
      .map(([node, geometry]) => {
        const stats = geometryStats(geometry);
        vertices += stats.vertices;
        triangles += stats.triangles;
        return { node, ...stats };
      })
      .sort((a, b) => b.triangles - a.triangles);

    const width = Math.max(4, ...rows.map((r) => r.node.length));
    console.log(`${file} — ${rows.length} nodes, ${vertices} verts, ${triangles} tris, ${(buffer.length / 1024).toFixed(1)} KB\n`);
    console.log(`${'node'.padEnd(width)}  ${'verts'.padStart(7)}  ${'tris'.padStart(7)}`);
    for (const row of rows) {
      console.log(`${row.node.padEnd(width)}  ${String(row.vertices).padStart(7)}  ${String(row.triangles).padStart(7)}`);
    }
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
