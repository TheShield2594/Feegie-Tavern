/**
 * Shared offline-rendering core: GLB reading, PNG writing, a 3x5 label font and
 * a z-buffered flat-shading rasteriser.
 *
 * Extracted so `renderKit.mjs` (one kit, model by model) and `renderMap.mjs`
 * (the island, at its real layout) draw with exactly the same code — a preview
 * that shaded differently from the map would be worse than no preview.
 *
 * No dependencies and no browser, deliberately: the environment that downloads
 * and builds the kits has no npm (see issue #21), so anything that needs three
 * or a bundler cannot run there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// --- GLB reading -----------------------------------------------------------

export function readGlb(path) {
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

export function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < accessor.count * components; i++) {
    if (accessor.componentType === 5126) out.push(bin.readFloatLE(base + i * 4));
    else if (accessor.componentType === 5123) out.push(bin.readUInt16LE(base + i * 2));
    else if (accessor.componentType === 5125) out.push(bin.readUInt32LE(base + i * 4));
    // COLOR_0 ships as normalised unsigned bytes holding *linear* values, per
    // the glTF spec. The rasteriser shades in sRGB bytes, so encode on the way
    // in — otherwise the preview shows the file darker than the game will.
    else if (accessor.componentType === 5121) {
      const v = bin.readUInt8(base + i) / 255;
      const encoded = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      out.push(Math.round(encoded * 255));
    }
  }
  return out;
}

export function loadNodes(path) {
  const { json, bin } = readGlb(path);
  return json.nodes.map((node) => {
    const primitive = json.meshes[node.mesh].primitives[0];
    return {
      name: node.name,
      positions: readAccessor(json, bin, primitive.attributes.POSITION),
      indices: readAccessor(json, bin, primitive.indices),
      // A baked-atlas kit carries its colour here instead of in a material, so
      // the preview has to read it or every building renders one flat green.
      colors: primitive.attributes.COLOR_0 !== undefined
        ? readAccessor(json, bin, primitive.attributes.COLOR_0)
        : null,
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

export function writePng(path, width, height, rgb) {
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

export function drawText(target, width, height, text, x, y, scale, colour) {
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

export const hexToRgb = (hex) => [
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
export function cameraBasis({ eye, target, fov }, width, height) {
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, fwd, right, up, focal: 1 / Math.tan((fov * Math.PI) / 180 / 2), aspect: width / height, width, height };
}

/** World point to pixel coordinates, or null when it is behind the camera. */
export function project(basis, p) {
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
export function frameCamera(contentWidth, contentHeight, centre, fov, aspect, margin = 1.12) {
  const halfV = Math.tan((fov * Math.PI) / 180 / 2);
  const halfH = halfV * aspect;
  const distance = Math.max(contentWidth / 2 / halfH, contentHeight / 2 / halfV) * margin;
  const [centreX, centreY] = centre;
  return {
    eye: [centreX, centreY + contentHeight * 0.06, distance],
    target: [centreX, centreY, 0],
    fov,
  };
}

export function render(meshes, width, height, camera, background, ss = 3) {
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
    const { positions, indices, rgb, colors = null, scale = 1, offset = [0, 0, 0] } = mesh;
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
      //
      // Flipped to face the camera when it points away. Back faces are already
      // culled by screen winding, so any face still being drawn is one the
      // viewer can see; lighting it by a normal pointing away from them drops
      // it to the ambient floor and the surface reads as if it were in shadow.
      // Ground planes wound either way then shade identically, which they
      // should.
      let n = norm(cross(sub(world[1], world[0]), sub(world[2], world[0])));
      const toEye = sub(eye, world[0]);
      if (dot(n, toEye) < 0) n = [-n[0], -n[1], -n[2]];
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

      // Flat shading means one colour per face, so an averaged corner colour is
      // what the game's own flatShading would show.
      let face = rgb;
      if (colors) {
        face = [0, 1, 2].map((c) =>
          (colors[indices[t] * 4 + c] + colors[indices[t + 1] * 4 + c] + colors[indices[t + 2] * 4 + c]) / 3,
        );
      }

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
          colour[at * 3] = Math.min(255, face[0] * shade);
          colour[at * 3 + 1] = Math.min(255, face[1] * shade);
          colour[at * 3 + 2] = Math.min(255, face[2] * shade);
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

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const edge = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

