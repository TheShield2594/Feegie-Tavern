import type { ItemDef, ItemVisual } from './types';
import { getItemDef } from '@/data/items';
import { FURNITURE_BY_ID, HOUSE_STYLES_BY_ID } from '@/data/furniture';

const cache = new Map<string, string>();

/**
 * Procedural item icons.
 *
 * Each icon is drawn from the item's `visual` parameters onto a canvas and
 * cached as a data URL. This gives the inventory, museum and shop real artwork
 * instead of emoji, costs nothing to ship, and is replaced later by pointing
 * `visual.texture` at a production sprite.
 */
export function iconFor(defIdOrDef: string | ItemDef, size = 96): string {
  const def = typeof defIdOrDef === 'string' ? resolve(defIdOrDef) : defIdOrDef;
  if (!def) return fallbackIcon(size);

  const key = `${def.id}@${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallbackIcon(size);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  const s = size / 100;
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawShape(ctx, def.visual);
  ctx.restore();

  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/**
 * Furniture and house styles are not inventory items, but the shop and home
 * panels still need artwork for them, so they are described as item visuals
 * on the fly from the same palette their 3D models use.
 */
function resolve(defId: string): ItemDef | undefined {
  const item = getItemDef(defId);
  if (item) return item;

  const furniture = FURNITURE_BY_ID.get(defId);
  if (furniture) {
    return {
      id: furniture.id,
      name: furniture.name,
      category: 'furniture',
      rarity: 'common',
      value: furniture.price,
      description: furniture.description,
      visual: {
        shape: furniture.kind,
        primary: furniture.palette.primary,
        secondary: furniture.palette.secondary,
        accent: furniture.palette.accent,
      },
    };
  }

  const style = HOUSE_STYLES_BY_ID.get(defId);
  if (style) {
    return {
      id: style.id,
      name: style.name,
      category: 'furniture',
      rarity: 'common',
      value: style.price,
      description: 'An exterior colourway for your cottage.',
      visual: { shape: 'houseStyle', primary: style.roof, secondary: style.body, accent: style.door },
    };
  }

  return undefined;
}

/** A 1×1 transparent PNG, for when canvas is unavailable entirely. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fallbackIcon(size: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // The caller reaches here precisely because a context could not be had, so
  // this one can fail too; returning a blank beats throwing out of the UI.
  if (!ctx) return BLANK_PNG;
  ctx.fillStyle = '#c9c2b4';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}

function drawShape(ctx: CanvasRenderingContext2D, visual: ItemVisual): void {
  const { primary, secondary, accent = '#3a3a42' } = visual;
  const scale = visual.scale ?? 1;
  ctx.scale(scale, scale);
  ctx.lineWidth = 2.4 / scale;
  ctx.strokeStyle = accent;

  switch (visual.shape) {
    case 'fish':
    case 'flatfish': {
      const squash = visual.shape === 'flatfish' ? 1.5 : 1;
      ctx.save();
      ctx.scale(1, 1 / squash);
      // Tail
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(24, 0);
      ctx.lineTo(44, -20);
      ctx.quadraticCurveTo(38, 0, 44, 20);
      ctx.closePath();
      ctx.fill();
      // Body
      const bodyGradient = ctx.createLinearGradient(0, -22, 0, 22);
      bodyGradient.addColorStop(0, secondary);
      bodyGradient.addColorStop(0.55, primary);
      bodyGradient.addColorStop(1, accent);
      ctx.fillStyle = bodyGradient;
      ctx.beginPath();
      ctx.moveTo(-42, 0);
      ctx.quadraticCurveTo(-14, -26, 26, -8);
      ctx.quadraticCurveTo(30, 0, 26, 8);
      ctx.quadraticCurveTo(-14, 26, -42, 0);
      ctx.closePath();
      ctx.fill();
      // Dorsal fin
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(-8, -17);
      ctx.quadraticCurveTo(4, -32, 16, -12);
      ctx.closePath();
      ctx.fill();
      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-26, -4, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(-27, -4, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'ray': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.quadraticCurveTo(46, -14, 40, 14);
      ctx.quadraticCurveTo(16, 8, 0, 26);
      ctx.quadraticCurveTo(-16, 8, -40, 14);
      ctx.quadraticCurveTo(-46, -14, 0, -26);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.ellipse(0, -4, 11, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tail
      ctx.strokeStyle = primary;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 24);
      ctx.quadraticCurveTo(6, 40, -4, 46);
      ctx.stroke();
      break;
    }

    case 'butterfly': {
      ctx.fillStyle = primary;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * 34, -42, side * 40, -8);
        ctx.quadraticCurveTo(side * 30, 4, 0, 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = secondary;
        ctx.beginPath();
        ctx.moveTo(0, 2);
        ctx.quadraticCurveTo(side * 28, 12, side * 26, 34);
        ctx.quadraticCurveTo(side * 12, 26, 0, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = primary;
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, 2, 4, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 2, -18);
        ctx.quadraticCurveTo(side * 14, -34, side * 20, -30);
        ctx.stroke();
      }
      break;
    }

    case 'beetle': {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, -22, 11, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      const shell = ctx.createLinearGradient(-20, -10, 20, 30);
      shell.addColorStop(0, secondary);
      shell.addColorStop(1, primary);
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.ellipse(0, 6, 24, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(0, 34);
      ctx.stroke();
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(side * 20, -6 + i * 14);
          ctx.lineTo(side * 38, -14 + i * 16);
          ctx.stroke();
        }
      }
      break;
    }

    case 'dragonfly': {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = secondary;
      for (const side of [-1, 1]) {
        for (const dy of [-8, 6]) {
          ctx.beginPath();
          ctx.ellipse(side * 26, dy, 26, 7, side * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.ellipse(0, 6, 5, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, -26, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'shell': {
      const g = ctx.createLinearGradient(0, -30, 0, 30);
      g.addColorStop(0, secondary);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.quadraticCurveTo(-44, 10, -30, -26);
      ctx.quadraticCurveTo(0, -38, 30, -26);
      ctx.quadraticCurveTo(44, 10, 0, 32);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 30);
        ctx.quadraticCurveTo(i * 11, 0, i * 9, -28);
        ctx.stroke();
      }
      break;
    }

    case 'ammonite': {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 9;
      ctx.beginPath();
      // A logarithmic spiral reads unmistakably as an ammonite.
      for (let a = 0; a < Math.PI * 4.4; a += 0.12) {
        const r = 3.4 * Math.exp(0.19 * a);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 3.4;
      ctx.stroke();
      break;
    }

    case 'star': {
      const outer = 40;
      const inner = 15;
      ctx.fillStyle = primary;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? outer : inner;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.fillStyle = secondary;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 20, Math.sin(a) * 20, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'jelly': {
      const g = ctx.createRadialGradient(0, -8, 4, 0, -8, 34);
      g.addColorStop(0, secondary);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.ellipse(0, -8, 34, 26, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 3;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 9, -8);
        ctx.quadraticCurveTo(i * 9 + 7, 14, i * 9 - 4, 36);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case 'bone': {
      ctx.fillStyle = primary;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-24, -20);
      ctx.quadraticCurveTo(0, -6, 24, 20);
      ctx.lineTo(14, 30);
      ctx.quadraticCurveTo(-8, 2, -32, -10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = secondary;
      for (const [x, y] of [[-30, -18], [-20, -26], [20, 28], [28, 18]] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'leaf': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.moveTo(0, 38);
      ctx.quadraticCurveTo(-34, 6, -6, -38);
      ctx.quadraticCurveTo(30, -4, 0, 38);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, 38);
      ctx.quadraticCurveTo(-4, 0, -6, -36);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const y = 22 - i * 13;
        ctx.beginPath();
        ctx.moveTo(-3, y);
        ctx.lineTo(-3 - 14 + i * 2, y - 10);
        ctx.moveTo(-3, y);
        ctx.lineTo(-3 + 16 - i * 2, y - 8);
        ctx.stroke();
      }
      break;
    }

    case 'root': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.ellipse(0, 10, 24, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.ellipse(0, -8, 24, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 13, -26, 8, 16, i * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'berry': {
      const g = ctx.createRadialGradient(-8, -10, 3, 0, 0, 32);
      g.addColorStop(0, secondary);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.bezierCurveTo(26, -26, 30, 12, 0, 34);
      ctx.bezierCurveTo(-30, 12, -26, -26, 0, -22);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(-12, -24);
      ctx.quadraticCurveTo(0, -38, 14, -24);
      ctx.quadraticCurveTo(0, -18, -12, -24);
      ctx.fill();
      break;
    }

    case 'gourd': {
      const g = ctx.createLinearGradient(-26, 0, 26, 0);
      g.addColorStop(0, primary);
      g.addColorStop(0.5, secondary);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 8, 34, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 2.2;
      for (const dx of [-18, 0, 18]) {
        ctx.beginPath();
        ctx.ellipse(dx, 8, 9, 27, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(6, -32, -4, -38);
      ctx.stroke();
      break;
    }

    case 'log': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-38, -16, 76, 32, 14);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.ellipse(-36, 0, 9, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      for (let r = 4; r <= 12; r += 4) {
        ctx.beginPath();
        ctx.ellipse(-36, 0, r * 0.6, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    case 'stone': {
      const g = ctx.createLinearGradient(-20, -24, 20, 24);
      g.addColorStop(0, secondary);
      g.addColorStop(1, primary);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-32, 10);
      ctx.lineTo(-18, -20);
      ctx.lineTo(12, -28);
      ctx.lineTo(34, -4);
      ctx.lineTo(24, 22);
      ctx.lineTo(-16, 26);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }

    case 'mushroom': {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(-10, -2);
      ctx.quadraticCurveTo(-13, 26, -8, 36);
      ctx.lineTo(8, 36);
      ctx.quadraticCurveTo(13, 26, 10, -2);
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.moveTo(-36, 0);
      ctx.quadraticCurveTo(-32, -38, 0, -38);
      ctx.quadraticCurveTo(32, -38, 36, 0);
      ctx.quadraticCurveTo(0, 10, -36, 0);
      ctx.fill();
      // A few pale flecks so the cap does not read as a flat dome.
      ctx.fillStyle = secondary;
      for (const [fx, fy, r] of [[-18, -10, 5], [4, -20, 6], [20, -8, 4]] as const) {
        ctx.beginPath();
        ctx.ellipse(fx, fy, r, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'fiber': {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 6;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-30 + i * 4, 30);
        ctx.quadraticCurveTo(i * 22, -6, i * 12 - 6, -32);
        ctx.stroke();
      }
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-26, 8);
      ctx.quadraticCurveTo(0, 20, 26, 4);
      ctx.stroke();
      break;
    }

    case 'dish': {
      ctx.fillStyle = '#f4f0e6';
      ctx.beginPath();
      ctx.ellipse(0, 8, 40, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cfc7b6';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.ellipse(0, 2, 27, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = secondary;
      for (const [dx, dy] of [[-11, -2], [8, -6], [2, 5]] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(14, 2, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'seed': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-24, -28, 48, 56, 8);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.roundRect(-24, -28, 48, 16, 8);
      ctx.fill();
      ctx.fillStyle = accent;
      for (const [dx, dy] of [[-8, 2], [8, 6], [0, 16]] as [number, number][]) {
        ctx.beginPath();
        ctx.ellipse(dx, dy, 5, 7, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'sofa': {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.roundRect(-38, -22, 76, 26, 11);
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-38, -2, 76, 24, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-42, -8, 12, 30, 6);
      ctx.roundRect(30, -8, 12, 30, 6);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(-30, 22, 7, 10);
      ctx.fillRect(23, 22, 7, 10);
      break;
    }

    case 'table': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-40, -16, 80, 12, 5);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(-32, -4, 8, 34);
      ctx.fillRect(24, -4, 8, 34);
      ctx.fillRect(-30, 6, 60, 5);
      break;
    }

    case 'lamp': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.moveTo(-24, -8);
      ctx.lineTo(24, -8);
      ctx.lineTo(15, -34);
      ctx.lineTo(-15, -34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, -6, 22, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(-4, -6, 8, 36);
      ctx.beginPath();
      ctx.ellipse(0, 32, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'rug': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.ellipse(0, 4, 42, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.ellipse(0, 4, 31, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, 4, 16, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'music': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-36, -18, 72, 42, 7);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.arc(-8, 4, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(-8, 4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(24, -8);
      ctx.lineTo(6, 10);
      ctx.stroke();
      break;
    }

    case 'plant': {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(-20, 4);
      ctx.lineTo(20, 4);
      ctx.lineTo(14, 34);
      ctx.lineTo(-14, 34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = primary;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.5;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 20, 2 + Math.sin(a) * 22, 9, 22, a + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'shelf': {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-38, -20, 76, 8, 3);
      ctx.roundRect(-38, 14, 76, 8, 3);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(-34, -12, 10, 26);
      ctx.fillStyle = accent;
      for (let i = 0; i < 4; i++) ctx.fillRect(-18 + i * 11, -12, 8, 26);
      break;
    }

    case 'bed': {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.roundRect(-40, -4, 80, 26, 6);
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-38, -14, 76, 14, 6);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(-38, -14, 34, 14, 6);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(-44, -26, 9, 48);
      break;
    }

    case 'houseStyle': {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.roundRect(-30, -6, 60, 38, 5);
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.moveTo(-38, -4);
      ctx.lineTo(0, -34);
      ctx.lineTo(38, -4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(-9, 8, 18, 24, 3);
      ctx.fill();
      break;
    }

    case 'chair':
    case 'furniture':
    default: {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.roundRect(-22, -6, 44, 12, 5);
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(-18, 6, 7, 26);
      ctx.fillRect(11, 6, 7, 26);
      ctx.beginPath();
      ctx.roundRect(-22, -34, 44, 10, 5);
      ctx.fill();
      ctx.fillRect(-20, -28, 6, 24);
      ctx.fillRect(14, -28, 6, 24);
      break;
    }
  }
}
