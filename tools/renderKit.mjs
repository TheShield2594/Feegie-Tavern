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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

// --- GLB reading -----------------------------------------------------------

function readGlb(path) {
  const buf = readFileSync(path);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = Buffer.from(data);
    offset += 8 + length;
  }
  return { json, bin };
}

function readAccessor(json, bin, index) {
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

function loadNodes(path) {
  const { json, bin } = readGlb(path);
  return json.nodes.map((node) => {
    const primitive = json.meshes[node.mesh].primitives[0];
    return {
      name: node.name,
      positions: readAccessor(json, bin, primitive.attributes.POSITION),
      indices: readAccessor(json, bin, primitive.indices),
    };
  });
}

// --- PNG writing -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function writePng(path, width, height, rgb) {
  const stride = width * 3;
  // PNG scanlines each carry a leading filter byte; 0 = no filtering.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// --- tiny 3x5 label font ---------------------------------------------------

const FONT = {
  a: [0b010, 0b101, 0b111, 0b101, 0b101], b: [0b110, 0b101, 0b110, 0b101, 0b110],
  c: [0b011, 0b100, 0b100, 0b100, 0b011], d: [0b110, 0b101, 0b101, 0b101, 0b110],
  e: [0b111, 0b100, 0b110, 0b100, 0b111], f: [0b111, 0b100, 0b110, 0b100, 0b100],
  g: [0b011, 0b100, 0b101, 0b101, 0b011], h: [0b101, 0b101, 0b111, 0b101, 0b101],
  i: [0b111, 0b010, 0b010, 0b010, 0b111], j: [0b001, 0b001, 0b001, 0b101, 0b010],
  k: [0b101, 0b101, 0b110, 0b101, 0b101], l: [0b100, 0b100, 0b100, 0b100, 0b111],
  m: [0b101, 0b111, 0b111, 0b101, 0b101], n: [0b110, 0b101, 0b101, 0b101, 0b101],
  o: [0b010, 0b101, 0b101, 0b101, 0b010], p: [0b110, 0b101, 0b110, 0b100, 0b100],
  q: [0b010, 0b101, 0b101, 0b111, 0b011], r: [0b110, 0b101, 0b110, 0b101, 0b101],
  s: [0b011, 0b100, 0b010, 0b001, 0b110], t: [0b111, 0b010, 0b010, 0b010, 0b010],
  u: [0b101, 0b101, 0b101, 0b101, 0b011], v: [0b101, 0b101, 0b101, 0b101, 0b010],
  w: [0b101, 0b101, 0b111, 0b111, 0b101], x: [0b101, 0b101, 0b010, 0b101, 0b101],
  y: [0b101, 0b101, 0b011, 0b001, 0b110], z: [0b111, 0b001, 0b010, 0b100, 0b111],
  0: [0b111, 0b101, 0b101, 0b101, 0b111], 1: [0b010, 0b110, 0b010, 0b010, 0b111],
  2: [0b111, 0b001, 0b111, 0b100, 0b111], 3: [0b111, 0b001, 0b111, 0b001, 0b111],
  4: [0b101, 0b101, 0b111, 0b001, 0b001], 5: [0b111, 0b100, 0b111, 0b001, 0b111],
  6: [0b111, 0b100, 0b111, 0b101, 0b111], 7: [0b111, 0b001, 0b001, 0b001, 0b001],
  8: [0b111, 0b101, 0b111, 0b101, 0b111], 9: [0b111, 0b101, 0b111, 0b001, 0b111],
  _: [0b000, 0b000, 0b000, 0b000, 0b111], '.': [0b000, 0b000, 0b000, 0b000, 0b010],
  '-': [0b000, 0b000, 0b111, 0b000, 0b000], ' ': [0, 0, 0, 0, 0],
};

function drawText(target, width, height, text, x, y, scale, colour) {
  let cursor = x;
  for (const char of text.toLowerCase()) {
    const glyph = FONT[char] ?? FONT[' '];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (!(glyph[row] & (1 << (2 - col)))) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cursor + col * scale + dx;
            const py = y + row * scale + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const at = (py * width + px) * 3;
            target[at] = colour[0];
            target[at + 1] = colour[1];
            target[at + 2] = colour[2];
          }
        }
      }
    }
    cursor += scale * 4;
  }
}

// --- rasteriser ------------------------------------------------------------

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Draws triangles with a z-buffer and flat shading.
 *
 * Rendered at `ss`x resolution and box-filtered down, which is the cheapest
 * way to get edges that do not crawl — low-poly silhouettes are almost all
 * edge, so unfiltered output reads as much rougher than the model is.
 */
function cameraBasis({ eye, target, fov }, width, height) {
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, fwd, right, up, focal: 1 / Math.tan((fov * Math.PI) / 180 / 2), aspect: width / height, width, height };
}

/** World point to pixel coordinates, or null when it is behind the camera. */
function project(basis, p) {
  const rel = sub(p, basis.eye);
  const z = dot(rel, basis.fwd);
  if (z <= 1e-4) return null;
  const x = dot(rel, basis.right);
  const y = dot(rel, basis.up);
  return [
    (((x * basis.focal) / z / basis.aspect) * 0.5 + 0.5) * basis.width,
    (0.5 - ((y * basis.focal) / z) * 0.5) * basis.height,
    z,
  ];
}

/**
 * Places the camera so a box of `contentWidth` x `contentHeight` fills the
 * frame with a little air around it, instead of being guessed at and leaving
 * half the image empty.
 */
function frameCamera(contentWidth, contentHeight, centreX, fov, aspect, margin = 1.12) {
  const halfV = Math.tan((fov * Math.PI) / 180 / 2);
  const halfH = halfV * aspect;
  const distance = Math.max(contentWidth / 2 / halfH, contentHeight / 2 / halfV) * margin;
  const midY = contentHeight * 0.46;
  return {
    eye: [centreX, midY + contentHeight * 0.06, distance],
    target: [centreX, midY, 0],
    fov,
  };
}

function render(meshes, width, height, camera, background, ss = 3) {
  const w = width * ss;
  const h = height * ss;
  const colour = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    colour[i * 3] = background[0];
    colour[i * 3 + 1] = background[1];
    colour[i * 3 + 2] = background[2];
  }
  const depth = new Float32Array(w * h).fill(Infinity);

  const basis = cameraBasis(camera, w, h);
  const { eye, fwd, right, up, focal, aspect } = basis;
  const light = norm([-0.45, 0.8, 0.42]);

  for (const mesh of meshes) {
    const { positions, indices, rgb, scale = 1, offset = [0, 0, 0] } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      const world = [0, 1, 2].map((k) => {
        const i = indices[t + k] * 3;
        return [
          positions[i] * scale + offset[0],
          positions[i + 1] * scale + offset[1],
          positions[i + 2] * scale + offset[2],
        ];
      });

      // Face normal — this is what flatShading draws.
      const n = norm(cross(sub(world[1], world[0]), sub(world[2], world[0])));
      const lambert = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      // Ambient floor keeps unlit faces readable rather than crushed to black.
      const shade = 0.34 + 0.66 * lambert;

      const screen = world.map((p) => {
        const rel = sub(p, eye);
        const z = dot(rel, fwd);
        if (z <= 1e-4) return null;
        const x = dot(rel, right);
        const y = dot(rel, up);
        return [((x * focal) / z / aspect * 0.5 + 0.5) * w, (0.5 - (y * focal) / z * 0.5) * h, z];
      });
      if (screen.some((p) => p === null)) continue;

      const area = edge(screen[0], screen[1], screen[2]);
      if (area <= 0) continue; // back-facing

      const minX = Math.max(0, Math.floor(Math.min(...screen.map((p) => p[0]))));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(...screen.map((p) => p[0]))));
      const minY = Math.max(0, Math.floor(Math.min(...screen.map((p) => p[1]))));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(...screen.map((p) => p[1]))));

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const p = [px + 0.5, py + 0.5];
          const w0 = edge(screen[1], screen[2], p);
          const w1 = edge(screen[2], screen[0], p);
          const w2 = edge(screen[0], screen[1], p);
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = (w0 * screen[0][2] + w1 * screen[1][2] + w2 * screen[2][2]) / area;
          const at = py * w + px;
          if (z >= depth[at]) continue;
          depth[at] = z;
          colour[at * 3] = Math.min(255, rgb[0] * shade);
          colour[at * 3 + 1] = Math.min(255, rgb[1] * shade);
          colour[at * 3 + 2] = Math.min(255, rgb[2] * shade);
        }
      }
    }
  }

  // Box-filter down to the requested size.
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) sum += colour[((y * ss + sy) * w + (x * ss + sx)) * 3 + c];
        }
        out[(y * width + x) * 3 + c] = Math.round(sum / (ss * ss));
      }
    }
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const edge = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

// --- the kit's own colours and scales --------------------------------------

// Mirrors PALETTE.foliage in src/rendering/palette.ts and the materials
// Foliage.ts binds: barkMaterial, canopyMaterial, pineMaterial, bushMaterial.
const BARK = hexToRgb('#8a6242');
const CANOPY = hexToRgb('#6a9a5f');
const PINE = hexToRgb('#3d7a54');
const BACKGROUND = hexToRgb('#f2e2c4'); // PALETTE.plaster.cream
const INK = hexToRgb('#5f432c'); // PALETTE.foliage.barkDark

function colourFor(node) {
  if (node.endsWith('_trunk')) return BARK;
  if (node.startsWith('tree_pine')) return PINE;
  return CANOPY;
}

// Scales as set in src/assets/manifest.ts.
const SCALES = {
  tree_default: 3.2,
  tree_pineDefaultA: 4.1,
  tree_palmShort: 5.7,
  tree_oak: 3.9,
  plant_bush: 3.5,
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

for (const [model, parts] of byModel) {
  const scale = SCALES[model] ?? 1;
  const height = extent(parts, 1).max * scale;
  const meshes = parts.map((p) => ({ ...p, rgb: colourFor(p.name), scale }));
  const size = 420;
  const x = extent(parts, 0);
  const camera = frameCamera(
    Math.max((x.max - x.min) * scale, height * 0.7),
    height * 1.18, // headroom for the label strip
    0,
    38,
    1,
  );
  // Nudge off dead-on so the silhouette reads as a solid rather than a cutout.
  camera.eye = [camera.eye[2] * 0.34, camera.eye[1], camera.eye[2] * 0.94];
  const pixels = render(meshes, size, size, camera, BACKGROUND);
  drawText(pixels, size, size, model, 12, size - 20, 2, INK);
  drawText(pixels, size, size, `${parts.length} node${parts.length > 1 ? 's' : ''}  x${scale}`, 12, size - 40, 1, INK);
  writePng(join(outDir, `${model}.png`), size, size, pixels);
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
const camera = frameCamera(cursor, tallest * 1.3, cursor / 2, 40, lineWidth / lineHeight);
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
