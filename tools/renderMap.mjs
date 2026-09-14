/**
 * Renders the island — terrain, paths, foliage, buildings — to PNG, offline.
 *
 *   npm run assets:map
 *
 * Without npm (see issue #21):
 *   node --experimental-strip-types --import ./tools/lib/no-npm.mjs tools/renderMap.mjs
 *
 * **This is not a screenshot of the game, and must not be presented as one.**
 * The environment that downloads and builds the kits has no npm (issue #21), so
 * the game cannot be built there, let alone run. What this does instead is draw
 * the island's *real layout* with the *real kit art*, using the same pure
 * modules the game uses:
 *
 *  - terrain height and surface come from `world/heightfield.ts` itself, imported
 *    and called directly — it is pure maths with no three dependency, and its
 *    own docstring calls it the single source of truth for where the ground is
 *  - `PATHS` is that module's own table
 *  - building footprints are read out of the `BUILDINGS` table in
 *    `world/Buildings.ts`
 *  - the models are the shipped GLBs at their manifest scales
 *
 * What it is missing, relative to the running game: the water shader, the sky,
 * the lighting rig, shadows, wind, season tint, post-processing, characters,
 * grass and flowers. It answers "is the art in the right places and does it sit
 * together" — not "what does the game look like".
 *
 * One honest caveat: the foliage scatter is a **replay** of the rules in
 * `world/Foliage.ts` (same seed, same constants, same order), not a call into
 * it — `Foliage` imports three, so it cannot run here. If those rules change,
 * this replay drifts until it is updated.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ISLAND_HALF, PATHS, sampleSurface, terrainHeight } from '../src/world/heightfield.ts';
import { Rng } from '../src/util/rng.ts';
import { loadNodes, writePng, drawText, hexToRgb, frameCamera, render } from './lib/raster.mjs';

// --- palette (mirrors src/rendering/palette.ts) -----------------------------

const C = {
  grass: hexToRgb('#7cb85f'),
  grassShadow: hexToRgb('#4f8c4a'),
  sand: hexToRgb('#e8d3a8'),
  path: hexToRgb('#c9a878'),
  plaza: hexToRgb('#d9c49a'),
  waterShallow: hexToRgb('#59c2cf'),
  waterMid: hexToRgb('#1d7fa8'),
  waterDeep: hexToRgb('#0f3f66'),
  bark: hexToRgb('#8a6242'),
  canopy: hexToRgb('#6a9a5f'),
  pine: hexToRgb('#3d7a54'),
  plaster: hexToRgb('#f2e2c4'),
  roof: hexToRgb('#537c96'),
  ink: hexToRgb('#2b3a42'),
  sky: hexToRgb('#cfe6ea'),
  foam: hexToRgb('#f2fbff'),
};

// --- the island's real layout ----------------------------------------------

/** Copied verbatim from `world/Foliage.ts` — see the caveat in the header. */
const KEEP_OUT = [
  { x: 0, z: 0, r: 19 }, { x: -25, z: -20, r: 11 }, { x: 22, z: -13, r: 11 },
  { x: -6, z: -40, r: 16 }, { x: 30, z: -34, r: 10 }, { x: -46, z: -8, r: 10 },
  { x: 44, z: 6, r: 10 }, { x: 0, z: -54, r: 13 }, { x: 42, z: -46, r: 13 },
  { x: -34, z: 20, r: 13 }, { x: 12, z: 52, r: 11 },
];

function distanceToPaths(x, z) {
  let best = Infinity;
  for (const p of PATHS) {
    const dx = p.bx - p.ax;
    const dz = p.bz - p.az;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - p.ax) * dx + (z - p.az) * dz) / lenSq));
    best = Math.min(best, Math.hypot(x - (p.ax + dx * t), z - (p.az + dz * t)) - p.width * 0.5);
  }
  return best;
}

const blockedByStructure = (x, z, clearance) =>
  KEEP_OUT.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + clearance);

/**
 * Replays `Foliage.buildTrees` then `Foliage.buildBushes` against the same
 * `Rng(90210)`. The shared generator is why the order matters: consuming it
 * differently would place every bush somewhere else.
 */
function scatterFoliage(density = 1) {
  const rng = new Rng(90210);
  const plans = [
    { kind: 'broadleaf', count: Math.round(120 * density), minHeight: 2.2, maxHeight: 16, maxSlope: 0.45, clearance: 2 },
    { kind: 'pine', count: Math.round(70 * density), minHeight: 6.5, maxHeight: 26, maxSlope: 0.58, clearance: 2 },
    { kind: 'palm', count: Math.round(34 * density), minHeight: 0.9, maxHeight: 3.0, maxSlope: 0.34, clearance: 3 },
    { kind: 'fruit', count: Math.round(26 * density), minHeight: 2.0, maxHeight: 11, maxSlope: 0.3, clearance: 4 },
  ];

  const trees = [];
  for (const plan of plans) {
    let placed = 0;
    let attempts = 0;
    while (placed < plan.count && attempts < plan.count * 40) {
      attempts++;
      const x = rng.spread(ISLAND_HALF - 8);
      const z = rng.spread(ISLAND_HALF - 8);
      const sample = sampleSurface(x, z);
      if (sample.height < plan.minHeight || sample.height > plan.maxHeight) continue;
      if (sample.slope > plan.maxSlope) continue;
      if (sample.surface === 'path' || sample.surface === 'plaza' || sample.surface === 'water') continue;
      if (distanceToPaths(x, z) < plan.clearance) continue;
      if (blockedByStructure(x, z, plan.clearance)) continue;
      if (plan.kind === 'fruit') {
        const nearOrchard = Math.hypot(x - 50, z - 22) < 22 || Math.hypot(x + 34, z - 20) < 18;
        if (!nearOrchard) continue;
      }
      if (plan.kind === 'palm') {
        const coastal = [[9, 0], [-9, 0], [0, 9], [0, -9]].some(
          ([dx, dz]) => sampleSurface(x + dx, z + dz).height < 0.2,
        );
        if (!coastal) continue;
      }
      trees.push({
        kind: plan.kind, x, z, y: sample.height,
        scale: rng.range(0.68, 1.02) * (plan.kind === 'palm' ? 1.15 : 1),
        rotation: rng.range(0, Math.PI * 2),
      });
      placed++;
    }
  }

  const bushes = [];
  const bushCount = Math.round(240 * density);
  let attempts = 0;
  while (bushes.length < bushCount && attempts < bushCount * 30) {
    attempts++;
    const x = rng.spread(ISLAND_HALF - 6);
    const z = rng.spread(ISLAND_HALF - 6);
    const sample = sampleSurface(x, z);
    if (sample.height < 2.1 || sample.slope > 0.5) continue;
    if (sample.surface !== 'grass') continue;
    if (distanceToPaths(x, z) < 1.4) continue;
    if (blockedByStructure(x, z, 1)) continue;
    bushes.push({ x, y: sample.height, z, s: rng.range(0.7, 1.5), r: rng.range(0, 6.28) });
    rng.next();
  }

  return { trees, bushes };
}

/**
 * Footprints straight out of the BUILDINGS table, read rather than guessed.
 *
 * Parsed per entry and per field rather than with one large pattern. The first
 * attempt was a single regex spanning the whole entry, and it silently dropped
 * every building whose name contains an apostrophe (those are double-quoted)
 * and then every one whose fields sit in a different order. Small patterns over
 * one entry at a time cannot fail that way, and the count assertion below
 * catches it if they do.
 */
function readBuildings() {
  const src = readFileSync('src/world/Buildings.ts', 'utf8');
  const body = src.slice(src.indexOf('export const BUILDINGS'));
  const entries = body.split(/\n  \{\n/).slice(1);
  const num = (text, key) => {
    const m = text.match(new RegExp(`\\b${key}:\\s*(-?[\\d.]+)`));
    return m ? +m[1] : null;
  };

  const out = [];
  for (const entry of entries) {
    const text = entry.split(/\n  \},/)[0];
    const name = text.match(/name:\s*'([^']*)'/) ?? text.match(/name:\s*"([^"]*)"/);
    const fields = {
      x: num(text, 'x'), z: num(text, 'z'),
      rotation: num(text, 'rotation') ?? 0,
      width: num(text, 'width'), depth: num(text, 'depth'),
      height: num(text, 'wallHeight'),
    };
    if (!name || Object.values(fields).some((v) => v === null)) continue;
    out.push({ name: name[1], ...fields });
  }

  // A regex over source is fragile by nature, so assert it found them all
  // rather than quietly rendering a map with buildings missing.
  if (out.length !== entries.length) {
    throw new Error(`BUILDINGS: read ${out.length} of ${entries.length} entries — the parser has drifted from the table`);
  }
  return out;
}

// --- geometry builders ------------------------------------------------------

/** Terrain as a grid, coloured per-cell by the surface the game reports. */
function buildTerrain(step) {
  const positions = [];
  const indices = [];
  const colours = [];
  let n = 0;
  for (let z = -ISLAND_HALF; z < ISLAND_HALF; z += step) {
    for (let x = -ISLAND_HALF; x < ISLAND_HALF; x += step) {
      const corners = [[x, z], [x + step, z], [x + step, z + step], [x, z + step]];
      const h = corners.map(([cx, cz]) => Math.max(0, terrainHeight(cx, cz)));
      for (let i = 0; i < 4; i++) positions.push(corners[i][0], h[i], corners[i][1]);
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;

      const sample = sampleSurface(x + step / 2, z + step / 2);
      let c = C.grass;
      if (sample.surface === 'sand') c = C.sand;
      else if (sample.surface === 'path') c = C.path;
      else if (sample.surface === 'plaza') c = C.plaza;
      else if (sample.surface === 'water') c = C.waterMid;
      else if (sample.height > 12) c = C.grassShadow;
      // Stride 4: the rasteriser reads vertex colour the way COLOR_0 ships it.
      for (let i = 0; i < 4; i++) colours.push(c[0], c[1], c[2], 255);
    }
  }
  return { positions, indices, colors: colours };
}

/** A flat sea quad at y = 0, so the island reads as an island. */
function buildSea() {
  // Far larger than the framing needs: a finite quad whose edge creeps into
  // shot reads as a bug rather than as the sea.
  const R = ISLAND_HALF * 6;
  return {
    positions: [-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R],
    indices: [0, 1, 2, 0, 2, 3],
    rgb: C.waterMid,
  };
}

/** One box per building, at its real footprint — massing, not architecture. */
function buildBox(cx, cy, cz, w, h, d, rot) {
  const positions = [];
  const indices = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (const y of [0, h]) {
    for (const [lx, lz] of corners) {
      positions.push(cx + lx * c - lz * s, cy + y, cz + lx * s + lz * c);
    }
  }
  const quad = (a, b, cc, d2) => indices.push(a, b, cc, a, cc, d2);
  quad(4, 5, 6, 7);                       // top
  quad(0, 1, 5, 4); quad(1, 2, 6, 5);     // sides
  quad(2, 3, 7, 6); quad(3, 0, 4, 7);
  return { positions, indices };
}

// --- compose ----------------------------------------------------------------

const outDir = process.argv[2] ?? 'docs/preview/map';
mkdirSync(outDir, { recursive: true });

const nature = new Map(loadNodes('public/assets/models/nature/nature.glb').map((n) => [n.name, n]));
const SCALE = { broadleaf: 3.2, pine: 4.1, palm: 4.2, fruit: 3.9 };
const NODE = {
  broadleaf: ['tree_default_trunk', 'tree_default_canopy'],
  pine: ['tree_pineDefaultA_trunk', 'tree_pineDefaultA_canopy'],
  palm: ['tree_palmDetailedTall_trunk', 'tree_palmDetailedTall_canopy'],
  fruit: ['tree_oak_trunk', 'tree_oak_canopy'],
};

const { trees, bushes } = scatterFoliage();
const buildings = readBuildings();
const meshes = [];

const terrain = buildTerrain(2.5);
meshes.push({ ...terrain, rgb: C.grass });
meshes.push({ ...buildSea() });

for (const t of trees) {
  const [trunkName, canopyName] = NODE[t.kind];
  const scale = SCALE[t.kind] * t.scale;
  for (const [name, rgb] of [[trunkName, C.bark], [canopyName, t.kind === 'pine' ? C.pine : C.canopy]]) {
    const node = nature.get(name);
    if (node) meshes.push({ ...node, rgb, scale, offset: [t.x, t.y, t.z] });
  }
}

const bushNode = nature.get('plant_bushDetailed');
for (const b of bushes) {
  if (bushNode) meshes.push({ ...bushNode, rgb: C.canopy, scale: 2.4 * b.s, offset: [b.x, b.y, b.z] });
}

for (const b of buildings) {
  const y = sampleSurface(b.x, b.z).height;
  meshes.push({ ...buildBox(b.x, y, b.z, b.width, b.height, b.depth, b.rotation), rgb: C.plaster });
  meshes.push({ ...buildBox(b.x, y + b.height, b.z, b.width + 0.8, 0.7, b.depth + 0.8, b.rotation), rgb: C.roof });
}

const W = 1600;
const H = 1100;

/**
 * Two views, because they answer different questions: the island shows whether
 * the placement rules put things where they should be, and the town shows
 * whether the art reads at the distance a player actually sees it.
 */
const VIEWS = [
  {
    file: 'island.png',
    caption: 'whole island',
    eye: [0, ISLAND_HALF * 1.05, ISLAND_HALF * 1.55],
    target: [0, 0, -6],
    fov: 42,
  },
  {
    file: 'town.png',
    caption: 'town square, cottage and store',
    eye: [-6, 34, 44],
    target: [-2, 2, -14],
    fov: 40,
  },
];

for (const view of VIEWS) {
  const camera = { eye: view.eye, target: view.target, fov: view.fov };
  const pixels = render(meshes, W, H, camera, C.sky, 2);
  drawText(pixels, W, H, `cozy cove - ${view.caption} - offline render, not a game screenshot`, 14, 16, 2, C.ink);
  drawText(pixels, W, H,
    `${trees.length} trees  ${bushes.length} bushes  ${buildings.length} buildings  -  real heightfield, real placement, shipped kit art`,
    14, H - 26, 2, C.foam);
  writePng(join(outDir, view.file), W, H, pixels);
}

console.log(`${outDir}/ — ${VIEWS.map((v) => v.file).join(', ')}`);
console.log(`${trees.length} trees, ${bushes.length} bushes, ${buildings.length} buildings`);
for (const b of buildings) console.log(`  ${b.name.padEnd(22)} (${b.x}, ${b.z})  ${b.width}x${b.depth}`);
