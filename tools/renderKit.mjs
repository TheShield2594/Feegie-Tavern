/**
 * Renders a kit GLB to PNG, with no browser and no dependencies.
 *
 *   node tools/renderKit.mjs public/assets/models/nature/nature.glb docs/preview
 *
 * Why a software rasteriser rather than a screenshot of the game: the point is
 * to see what a kit actually contains — before it is wired into a world system,
 * and without needing the app to build. It also cross-checks the numeric
 * invariants in `assets:verify` with something a person can look at: a tree
 * whose canopy has come unstuck from its trunk is obvious in a picture and
 * subtle in a bounding box.
 *
 * Deliberately faithful to how the game will shade these meshes:
 *
 *  - **Flat shading from face normals.** `Foliage`'s bark, canopy, pine and
 *    bush materials all set `flatShading: true`, so per-face normals are what
 *    the game draws, not an approximation of it.
 *  - **Palette colours**, taken from the same values in `rendering/palette.ts`
 *    that the materials pull from — bark, canopyMid, pine.
 *  - **Manifest scales**, so the lineup shows the models at the sizes `Foliage`
 *    will instance them at, relative to each other.
 *
 * It is not a lighting model — no shadows, no wind, no season tint. It answers
 * "what shape is this and is it assembled correctly", nothing more.
 */
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  loadNodes, writePng, drawText, hexToRgb, cameraBasis, project, frameCamera, render,
} from './lib/raster.mjs';

// --- the kit's own colours and scales --------------------------------------

// Mirrors PALETTE.foliage in src/rendering/palette.ts and the materials
// Foliage.ts binds: barkMaterial, canopyMaterial, pineMaterial, bushMaterial.
const BARK = hexToRgb('#8a6242');
const CANOPY = hexToRgb('#6a9a5f');
const PINE = hexToRgb('#3d7a54');
const BACKGROUND = hexToRgb('#f2e2c4'); // PALETTE.plaster.cream
const INK = hexToRgb('#5f432c'); // PALETTE.foliage.barkDark

/** The palette colour the game's materials would bind for a given node. */
function colourFor(node) {
  if (node.endsWith('_trunk')) return BARK;
  if (node.startsWith('tree_pine')) return PINE;
  return CANOPY;
}

// Scales as set in src/assets/manifest.ts.
const SCALES = {
  tree_default: 3.2,
  tree_pineDefaultA: 4.1,
  tree_palmDetailedTall: 4.2,
  tree_oak: 3.9,
  plant_bushDetailed: 2.4,
  plant_bushLarge: 3.5,
};

const glb = process.argv[2] ?? 'public/assets/models/nature/nature.glb';
const outDir = process.argv[3] ?? 'docs/preview';
mkdirSync(outDir, { recursive: true });

const nodes = loadNodes(glb);
const byModel = new Map();
for (const node of nodes) {
  const model = node.name.replace(/_(trunk|canopy)$/, '');
  if (!byModel.has(model)) byModel.set(model, []);
  byModel.get(model).push(node);
}

/** Min and max along one axis across every part of a model. */
const extent = (parts, axis) => {
  let min = Infinity;
  let max = -Infinity;
  for (const part of parts) {
    for (let i = axis; i < part.positions.length; i += 3) {
      min = Math.min(min, part.positions[i]);
      max = Math.max(max, part.positions[i]);
    }
  }
  return { min, max };
};

// --- one PNG per assembled model -------------------------------------------

const tiles = [];

for (const [model, parts] of byModel) {
  const scale = SCALES[model] ?? 1;
  const meshes = parts.map((p) => ({ ...p, rgb: colourFor(p.name), scale }));
  const size = 420;

  // Frame on the model's own bounding box, not on the origin. Modular pieces
  // are deliberately off-centre — a wall sits at x 0.40..0.50 so it forms its
  // tile's edge — and framing those around x = 0 pushes them out of shot.
  const x = extent(parts, 0);
  const y = extent(parts, 1);
  const z = extent(parts, 2);
  const centreX = ((x.min + x.max) / 2) * scale;
  const centreY = ((y.min + y.max) / 2) * scale;
  const spanX = Math.max((x.max - x.min) * scale, (z.max - z.min) * scale);
  const spanY = (y.max - y.min) * scale;
  const camera = frameCamera(
    Math.max(spanX, spanY * 0.7),
    Math.max(spanY, spanX * 0.5) * 1.3, // headroom for the label strip
    [centreX, centreY],
    38,
    1,
  );
  // Nudge off dead-on so the silhouette reads as a solid rather than a cutout,
  // and lift the camera. Flat pieces — the road and path tiles are 0.03 units
  // tall — otherwise sit almost exactly at eye level and render as a line.
  const distance = camera.eye[2];
  camera.eye = [
    centreX + distance * 0.34,
    centreY + Math.max(spanY * 0.5, spanX * 0.42),
    distance * 0.94,
  ];
  camera.target = [centreX, centreY, 0];
  const pixels = render(meshes, size, size, camera, BACKGROUND);
  drawText(pixels, size, size, model, 12, size - 20, 2, INK);
  drawText(pixels, size, size, `${parts.length} node${parts.length > 1 ? 's' : ''}  x${scale}`, 12, size - 40, 1, INK);
  writePng(join(outDir, `${model}.png`), size, size, pixels);
  tiles.push({ model, size, pixels });
}

// --- contact sheet ---------------------------------------------------------
//
// A single row stops being readable past a handful of models, and a modular
// building kit is two dozen. The tiles are already rendered, so the sheet is
// just a blit.

{
  const columns = Math.min(6, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.ceil(tiles.length / columns);
  const tile = tiles[0]?.size ?? 420;
  const pad = 6;
  const header = 30;
  const width = columns * tile + pad * (columns + 1);
  const height = header + rows * tile + pad * (rows + 1);
  const sheet = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    sheet[i * 3] = BACKGROUND[0];
    sheet[i * 3 + 1] = BACKGROUND[1];
    sheet[i * 3 + 2] = BACKGROUND[2];
  }

  tiles.forEach((t, i) => {
    const cx = pad + (i % columns) * (tile + pad);
    const cy = header + pad + Math.floor(i / columns) * (tile + pad);
    for (let y = 0; y < tile; y++) {
      t.pixels.copy(sheet, ((cy + y) * width + cx) * 3, y * tile * 3, (y + 1) * tile * 3);
    }
  });

  drawText(sheet, width, height, `${basename(glb)} - ${tiles.length} models - kenney cc0`, 12, 10, 2, INK);
  writePng(join(outDir, 'contact.png'), width, height, sheet);
}

// --- the lineup: every model at true relative scale on one ground line ------

const lineup = [];
let cursor = 0;
const labels = [];
for (const [model, parts] of byModel) {
  const scale = SCALES[model] ?? 1;
  const x = extent(parts, 0);
  // A minimum slot keeps the bushes from bunching up against the trees.
  const slot = Math.max((x.max - x.min) * scale, 2.6);
  cursor += slot * 0.5 + 0.9;
  for (const part of parts) {
    lineup.push({ ...part, rgb: colourFor(part.name), scale, offset: [cursor, 0, 0] });
  }
  labels.push({ model, x: cursor, height: extent(parts, 1).max * scale });
  cursor += slot * 0.5 + 0.9;
}

const tallest = Math.max(...labels.map((l) => l.height));
const lineWidth = 1280;
const lineHeight = 520;
const camera = frameCamera(cursor, tallest * 1.3, [cursor / 2, tallest * 0.46], 40, lineWidth / lineHeight);
const lineupPixels = render(lineup, lineWidth, lineHeight, camera, BACKGROUND);

drawText(lineupPixels, lineWidth, lineHeight, 'cozy cove - nature kit - kenney cc0 - manifest scales', 14, 16, 2, INK);

// Labels are projected from each model's own world position, so they sit under
// the model they name rather than on a guessed grid.
const basis = cameraBasis(camera, lineWidth, lineHeight);
for (const label of labels) {
  const at = project(basis, [label.x, 0, 0]);
  if (!at) continue;
  const text = label.model.toLowerCase();
  drawText(lineupPixels, lineWidth, lineHeight, text, Math.round(at[0] - text.length * 4), lineHeight - 26, 2, INK);
}
writePng(join(outDir, 'lineup.png'), lineWidth, lineHeight, lineupPixels);

console.log(`${outDir}/lineup.png + ${byModel.size} model renders`);
for (const [model, parts] of byModel) {
  console.log(`  ${model.padEnd(20)} ${parts.length} node(s)  scale x${SCALES[model] ?? 1}`);
}
