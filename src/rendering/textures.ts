import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Procedural surface textures, baked to small canvases at load.
 *
 * Every texture here is *neutral*: a light base with darker seams and gentle
 * grain, meant to be multiplied by the material's own colour. That is what
 * keeps a house repaintable — `Buildings.applyHouseStyle` swaps colours by
 * matching material tints, which a coloured texture would silently break —
 * and it means one roof texture serves slate, terracotta and moss alike.
 *
 * Sizes are tiny (128–256 px) on purpose. At the game's camera distance a
 * texture is texture; the detail is in the vertex colours and the lighting.
 */

const cache = new Map<string, CanvasTexture>();

/** Bakes a texture once per key and caches it; every generator below goes through here. */
function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): CanvasTexture {
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/** Cheap deterministic noise so a texture bakes identically every load. */
function hash(x: number, y: number, seed = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** A neutral CSS grey for a 0–1 luminance. */
function grey(v: number): string {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c},${c},${c})`;
}

/** Fine speckle over the whole canvas. `amount` is the ± luminance range. */
function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, cell = 2, seed = 0): void {
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const n = (hash(x, y, seed) - 0.5) * amount;
      ctx.fillStyle = n > 0 ? `rgba(255,255,255,${n})` : `rgba(0,0,0,${-n})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

/**
 * Overlapping roof tiles, four courses per repeat. Each tile carries its own
 * shade and a dark underside so the roof reads as tiled from any distance.
 */
export function roofTileTexture(): Texture {
  return make('roof', 256, (ctx, size) => {
    ctx.fillStyle = grey(0.82);
    ctx.fillRect(0, 0, size, size);
    const rows = 4;
    const cols = 6;
    const th = size / rows;
    const tw = size / cols;
    for (let r = -1; r <= rows; r++) {
      const offset = r % 2 === 0 ? 0 : tw / 2;
      for (let c = -1; c <= cols; c++) {
        const x = c * tw + offset;
        const y = r * th;
        const shade = 0.86 + (hash(c, r, 3) - 0.5) * 0.18;
        // Body of the tile.
        ctx.fillStyle = grey(shade);
        ctx.beginPath();
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + tw - 2, y);
        ctx.lineTo(x + tw - 2, y + th - 8);
        ctx.quadraticCurveTo(x + tw / 2, y + th + 4, x + 2, y + th - 8);
        ctx.closePath();
        ctx.fill();
        // Lit top edge and dark lower lip.
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x + 2, y, tw - 4, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + th - 8);
        ctx.quadraticCurveTo(x + tw / 2, y + th + 4, x + tw - 2, y + th - 8);
        ctx.lineTo(x + tw - 2, y + th - 3);
        ctx.quadraticCurveTo(x + tw / 2, y + th + 9, x + 2, y + th - 3);
        ctx.closePath();
        ctx.fill();
      }
    }
    grain(ctx, size, 0.05, 2, 9);
  });
}

/** Wooden boards laid along V, with grain and dark seams. */
export function plankTexture(boards = 4): Texture {
  return make(`plank${boards}`, 256, (ctx, size) => {
    const bw = size / boards;
    for (let b = 0; b < boards; b++) {
      const shade = 0.88 + (hash(b, 1, 5) - 0.5) * 0.14;
      ctx.fillStyle = grey(shade);
      ctx.fillRect(b * bw, 0, bw, size);
      // Grain lines.
      for (let i = 0; i < 9; i++) {
        const gx = b * bw + 6 + hash(i, b, 7) * (bw - 12);
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + hash(i, b, 8) * 0.07})`;
        ctx.lineWidth = 1 + hash(i, b, 11) * 1.5;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 3, size * 0.33, gx - 3, size * 0.66, gx + 1, size);
        ctx.stroke();
      }
      // Seam between boards and a bevelled highlight.
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.fillRect(b * bw, 0, 3, size);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(b * bw + 3, 0, 2, size);
      // The odd end joint.
      const joint = Math.floor(hash(b, 2, 13) * size);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(b * bw, joint, bw, 3);
    }
    grain(ctx, size, 0.06, 2, 17);
  });
}

/** Rendered plaster: soft blotches, a little grit, no hard lines. */
export function plasterTexture(): Texture {
  return make('plaster', 128, (ctx, size) => {
    ctx.fillStyle = grey(0.96);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const x = hash(i, 0, 21) * size;
      const y = hash(i, 1, 21) * size;
      const r = 8 + hash(i, 2, 21) * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = hash(i, 3, 21) > 0.5;
      g.addColorStop(0, dark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    grain(ctx, size, 0.07, 1, 23);
  });
}

/** Rough stone blocks in staggered courses, for plinths and the lighthouse. */
export function stoneTexture(): Texture {
  return make('stone', 256, (ctx, size) => {
    ctx.fillStyle = grey(0.62);
    ctx.fillRect(0, 0, size, size);
    const rows = 4;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 === 0 ? 0 : size / 6;
      const cols = 3;
      for (let c = -1; c <= cols; c++) {
        const x = c * (size / cols) + offset + 2;
        const y = r * rh + 2;
        const w = size / cols - 4;
        const h = rh - 4;
        ctx.fillStyle = grey(0.8 + (hash(c, r, 31) - 0.5) * 0.16);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x + 2, y + 2, w - 4, 2);
      }
    }
    grain(ctx, size, 0.08, 2, 37);
  });
}

/** Flagstones for the plaza: irregular light slabs with sandy joints. */
export function flagstoneTexture(): Texture {
  return make('flag', 256, (ctx, size) => {
    ctx.fillStyle = grey(0.7);
    ctx.fillRect(0, 0, size, size);
    const n = 4;
    const cell = size / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const jitter = 6;
        const x = i * cell + 3 + (hash(i, j, 41) - 0.5) * jitter;
        const y = j * cell + 3 + (hash(i, j, 43) - 0.5) * jitter;
        const w = cell - 6 + (hash(i, j, 47) - 0.5) * jitter;
        const h = cell - 6 + (hash(i, j, 53) - 0.5) * jitter;
        ctx.fillStyle = grey(0.88 + (hash(i, j, 59) - 0.5) * 0.12);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 9);
        ctx.fill();
      }
    }
    grain(ctx, size, 0.05, 2, 61);
  });
}

/** Woven thatch / reed, for beach parasols and the odd roof. */
export function weaveTexture(): Texture {
  return make('weave', 128, (ctx, size) => {
    ctx.fillStyle = grey(0.9);
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 6) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + hash(y, 0, 71) * 0.08})`;
      ctx.fillRect(0, y, size, 2);
    }
    for (let x = 0; x < size; x += 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(x, 0, 2, size);
    }
    grain(ctx, size, 0.06, 2, 73);
  });
}
