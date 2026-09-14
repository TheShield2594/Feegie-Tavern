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
  }

  // The canopy is the one that proves `centreXZ: false` preserves an authored
  // offset: the fixture puts it at x 0.6..2.6 while the trunk straddles the
  // origin, so checking the trunk here only repeated the test above.
  const rawCanopy = raw.get('tree_canopy');
  check('raw canopy present', Boolean(rawCanopy));
  if (rawCanopy) {
    const rawCanopyBox = new Box3().setFromBufferAttribute(rawCanopy.getAttribute('position') as never);
    check(
      'canopy X offset survives when not recentred',
      near(rawCanopyBox.min.x, 0.6 * parentScale + parentTranslation[0]),
      `min.x=${rawCanopyBox.min.x.toFixed(4)} expected=${(0.6 * parentScale + parentTranslation[0]).toFixed(4)}`,
    );
  }

  // --- attribute hygiene ---------------------------------------------------
  check('vertex colours dropped by default', !trunk.getAttribute('color'));
  const stats = geometryStats(trunk);
  check('stats report a solid box', stats.triangles === 12, `triangles=${stats.triangles}`);

  // --- per-node options ----------------------------------------------------
  // The production path in AssetManager hands extractGeometries a resolver, so
  // that one kit can hold models with different scales and grounding. Passing
  // a single options object instead silently drops every manifest `normalize`:
  // models load at the kit's authored size, and each node is grounded on its
  // own, which puts a canopy at the foot of its trunk rather than on top.
  const perNode = extractGeometries(scene, (node) =>
    node === 'tree_trunk'
      ? { groundOrigin: false, centreXZ: false, scale: 2 }
      : { groundOrigin: false, centreXZ: false },
  );
  const scaledTrunk = perNode.get('tree_trunk');
  const plainCanopy = perNode.get('tree_canopy');
  check('resolver is asked per node', Boolean(scaledTrunk && plainCanopy));
  if (scaledTrunk && plainCanopy) {
    const scaledBox = new Box3().setFromBufferAttribute(scaledTrunk.getAttribute('position') as never);
    const plainBox = new Box3().setFromBufferAttribute(plainCanopy.getAttribute('position') as never);
    const unscaled = new Box3().setFromBufferAttribute(
      raw.get('tree_trunk')!.getAttribute('position') as never,
    );
    check(
      'per-node scale is applied',
      near(scaledBox.max.y - scaledBox.min.y, (unscaled.max.y - unscaled.min.y) * 2),
      `height=${(scaledBox.max.y - scaledBox.min.y).toFixed(4)}`,
    );
    check(
      'a node given no scale is left alone',
      near(plainBox.min.y, new Box3().setFromBufferAttribute(
        raw.get('tree_canopy')!.getAttribute('position') as never,
      ).min.y),
      `min.y=${plainBox.min.y.toFixed(4)}`,
    );
  }

  console.log(failures === 0 ? '\nAll asset-import checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
