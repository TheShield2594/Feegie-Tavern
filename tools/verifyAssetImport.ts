/**
 * Exercises the GLB import path against a generated fixture.
 *
 * Checks the properties the renderer actually depends on:
 *  - meshes nested under a transformed parent have that transform baked in
 *  - `groundOrigin` puts the lowest vertex at y = 0, which the wind shader's
 *    local-Y stiffness term and terrain placement both assume
 *  - `centreXZ` centres the model horizontally
 *  - attributes the renderer never reads are dropped
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, type Object3D } from 'three';
import { extractGeometries, geometryStats } from '../src/assets/gltfImport';
import { buildTestGlb } from './makeTestGlb';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  const mark = condition ? '  ok  ' : ' FAIL ';
  if (!condition) failures += 1;
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

function near(a: number, b: number, epsilon = 1e-4): boolean {
  return Math.abs(a - b) < epsilon;
}

async function parse(buffer: Buffer): Promise<Object3D> {
  const loader = new GLTFLoader();
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(array as ArrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

async function main(): Promise<void> {
  const parentTranslation: [number, number, number] = [10, 5, -3];
  const parentScale = 2;
  const scene = await parse(buildTestGlb({ parentTranslation, parentScale }));

  // --- normalised (what the game uses) ------------------------------------
  const normalised = extractGeometries(scene);
  check('both meshes extracted', normalised.size === 2, `got ${[...normalised.keys()].join(', ')}`);

  const trunk = normalised.get('tree_trunk');
  check('trunk present', Boolean(trunk));
  if (!trunk) { process.exit(1); }

  const box = new Box3().setFromBufferAttribute(trunk.getAttribute('position') as never);
  check('groundOrigin drops base to y=0', near(box.min.y, 0), `min.y=${box.min.y.toFixed(4)}`);
  check(
    'centreXZ centres horizontally',
    near((box.min.x + box.max.x) / 2, 0) && near((box.min.z + box.max.z) / 2, 0),
    `centre=(${((box.min.x + box.max.x) / 2).toFixed(4)}, ${((box.min.z + box.max.z) / 2).toFixed(4)})`,
  );

  // Trunk is 1.5 units tall in local space; the parent scales by 2.
  check(
    'parent scale is baked',
    near(box.max.y - box.min.y, 1.5 * parentScale),
    `height=${(box.max.y - box.min.y).toFixed(4)} expected=${(1.5 * parentScale).toFixed(4)}`,
  );

  // --- raw (transform baked, nothing recentred) ---------------------------
  const raw = extractGeometries(scene, { groundOrigin: false, centreXZ: false });
  const rawTrunk = raw.get('tree_trunk');
  check('raw trunk present', Boolean(rawTrunk));
  if (rawTrunk) {
    const rawBox = new Box3().setFromBufferAttribute(rawTrunk.getAttribute('position') as never);
    // local y0=0.5, scaled by 2 → 1.0, then translated by +5.
    check(
      'parent translation is baked',
      near(rawBox.min.y, 0.5 * parentScale + parentTranslation[1]),
      `min.y=${rawBox.min.y.toFixed(4)} expected=${(0.5 * parentScale + parentTranslation[1]).toFixed(4)}`,
    );
    check(
      'canopy X offset survives when not recentred',
      near(rawBox.min.x, -0.2 * parentScale + parentTranslation[0]),
      `min.x=${rawBox.min.x.toFixed(4)}`,
    );
  }

  // --- attribute hygiene ---------------------------------------------------
  check('vertex colours dropped by default', !trunk.getAttribute('color'));
  const stats = geometryStats(trunk);
  check('stats report a solid box', stats.triangles === 12, `triangles=${stats.triangles}`);

  console.log(failures === 0 ? '\nAll asset-import checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
