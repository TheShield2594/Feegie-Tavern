import type { CharacterLook } from '@/data/clothing';
import type { VillagerLook } from '@/data/villagers';
import type { Expression } from '@/player/CharacterRig';

/**
 * Portrait art, drawn from the same look data that builds the 3D models.
 *
 * A villager's portrait and their model always agree because both read the same
 * colours, ear shape and accessory. Cached by look signature.
 */
const cache = new Map<string, string>();

export function villagerPortrait(look: VillagerLook, expression: Expression = 'neutral', size = 148): string {
  const key = `v:${look.species}:${look.fur}:${look.cream}:${look.outfit}:${look.earStyle}:${look.accessory ?? ''}:${expression}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(size);
  drawBackdrop(ctx, size, look.outfit);

  ctx.save();
  ctx.translate(size / 2, size * 0.56);
  const s = size / 150;
  ctx.scale(s, s);

  // Shoulders and clothing
  ctx.fillStyle = look.outfit;
  ctx.beginPath();
  ctx.ellipse(0, 74, 62, 34, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = look.outfitTrim;
  ctx.beginPath();
  ctx.ellipse(0, 66, 26, 12, 0, Math.PI, 0);
  ctx.fill();

  drawEars(ctx, look);

  // Head
  ctx.fillStyle = look.fur;
  ctx.beginPath();
  ctx.ellipse(0, 0, 48, 46, 0, 0, Math.PI * 2);
  ctx.fill();

  // Muzzle
  ctx.fillStyle = look.cream;
  ctx.beginPath();
  ctx.ellipse(0, 16, 27, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#4a3830';
  ctx.beginPath();
  ctx.ellipse(0, 8, 7.5, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  drawFace(ctx, expression, '#2b2a33');

  if (look.accessory === 'spectacles') {
    ctx.strokeStyle = '#3a3a42';
    ctx.lineWidth = 2.6;
    for (const dx of [-17, 17]) {
      ctx.beginPath();
      ctx.arc(dx, -6, 13, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-4, -6);
    ctx.lineTo(4, -6);
    ctx.stroke();
  }
  if (look.accessory === 'sunhat') {
    ctx.fillStyle = '#e8d29a';
    ctx.beginPath();
    ctx.ellipse(0, -34, 62, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -42, 33, 22, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = look.outfit;
    ctx.fillRect(-33, -38, 66, 7);
  }
  if (look.accessory === 'scarf') {
    ctx.fillStyle = look.outfitTrim;
    ctx.beginPath();
    ctx.ellipse(0, 50, 34, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function playerPortrait(look: CharacterLook, expression: Expression = 'neutral', size = 148): string {
  const key = `p:${look.skin}:${look.hairColor}:${look.hairStyle}:${look.shirtColor}:${look.hat}:${expression}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(size);
  drawBackdrop(ctx, size, look.shirtColor);

  ctx.save();
  ctx.translate(size / 2, size * 0.56);
  const s = size / 150;
  ctx.scale(s, s);

  ctx.fillStyle = look.shirtColor;
  ctx.beginPath();
  ctx.ellipse(0, 74, 60, 34, 0, Math.PI, 0);
  ctx.fill();

  // Neck
  ctx.fillStyle = shade(look.skin, -0.12);
  ctx.fillRect(-11, 32, 22, 20);

  // Hair behind the head
  ctx.fillStyle = look.hairColor;
  if (look.hairStyle === 'bob' || look.hairStyle === 'wave' || look.hairStyle === 'curls') {
    ctx.beginPath();
    ctx.ellipse(0, 6, 52, 52, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.hairStyle === 'ponytail') {
    ctx.beginPath();
    ctx.ellipse(0, 30, 15, 32, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.hairStyle === 'braids') {
    for (const dx of [-46, 46]) {
      ctx.beginPath();
      ctx.ellipse(dx, 22, 11, 30, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Head
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.ellipse(0, 0, 44, 47, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair front
  ctx.fillStyle = look.hairColor;
  ctx.beginPath();
  ctx.ellipse(0, -14, 45, 34, 0, Math.PI, 0);
  ctx.fill();
  if (look.hairStyle === 'bun') {
    ctx.beginPath();
    ctx.arc(0, -48, 17, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.hairStyle === 'wave') {
    ctx.beginPath();
    ctx.ellipse(-34, -8, 16, 26, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.hairStyle === 'curls') {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 44, Math.sin(a) * 40 - 6, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawFace(ctx, expression, '#2b2a33');

  if (look.hat !== 'none') drawHat(ctx, look);

  ctx.restore();
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

// --- Helpers -----------------------------------------------------------------

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

function drawBackdrop(ctx: CanvasRenderingContext2D, size: number, accent: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, shade(accent, 0.42));
  g.addColorStop(1, shade(accent, 0.06));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // A soft vignette so the head reads against the panel.
  const v = ctx.createRadialGradient(size / 2, size * 0.44, size * 0.12, size / 2, size * 0.5, size * 0.62);
  v.addColorStop(0, 'rgba(255,255,255,0.28)');
  v.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, size, size);
}

function drawEars(ctx: CanvasRenderingContext2D, look: VillagerLook): void {
  ctx.fillStyle = look.fur;
  const inner = look.cream;

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 32, -34);
    switch (look.earStyle) {
      case 'long':
        ctx.rotate(side * 0.2);
        ctx.beginPath();
        ctx.ellipse(0, -26, 12, 34, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.ellipse(0, -26, 6, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tuft':
        ctx.beginPath();
        ctx.moveTo(-16, 8);
        ctx.lineTo(side * 6, -28);
        ctx.lineTo(16, 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.moveTo(-8, 6);
        ctx.lineTo(side * 4, -16);
        ctx.lineTo(8, 6);
        ctx.closePath();
        ctx.fill();
        break;
      case 'feathered':
        ctx.beginPath();
        ctx.moveTo(-18, 10);
        ctx.lineTo(side * 14, -22);
        ctx.lineTo(12, 10);
        ctx.closePath();
        ctx.fill();
        break;
      case 'round':
      default:
        ctx.beginPath();
        ctx.arc(0, -6, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = inner;
        ctx.beginPath();
        ctx.arc(0, -6, 10, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.restore();
    ctx.fillStyle = look.fur;
  }
}

function drawFace(ctx: CanvasRenderingContext2D, expression: Expression, ink: string): void {
  const eyeY = -8;
  const eyeX = 17;

  const shapes: Record<Expression, { eye: number; brow: number; browY: number; mouth: 'smile' | 'open' | 'flat' | 'frown' }> = {
    neutral: { eye: 1, brow: 0, browY: 0, mouth: 'smile' },
    happy: { eye: 0.62, brow: 0.12, browY: -2, mouth: 'smile' },
    surprised: { eye: 1.25, brow: -0.1, browY: -5, mouth: 'open' },
    sad: { eye: 0.9, brow: -0.3, browY: 1, mouth: 'frown' },
    determined: { eye: 0.85, brow: 0.34, browY: 2, mouth: 'flat' },
    sleepy: { eye: 0.32, brow: 0.06, browY: 1, mouth: 'flat' },
    excited: { eye: 1.15, brow: 0.18, browY: -4, mouth: 'open' },
  };
  const shape = shapes[expression] ?? shapes.neutral;

  for (const side of [-1, 1]) {
    // Eye white
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(side * eyeX, eyeY, 8.5, 10 * shape.eye, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupil
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(side * eyeX, eyeY + 1, 5.2, 6.4 * shape.eye, 0, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(side * eyeX + 2.4, eyeY - 2.6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // Brow
    ctx.strokeStyle = shade(ink, 0.14);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * (eyeX - 9), eyeY - 15 + shape.browY + side * shape.brow * 5);
    ctx.lineTo(side * (eyeX + 9), eyeY - 16 + shape.browY - side * shape.brow * 5);
    ctx.stroke();
  }

  // Mouth
  ctx.strokeStyle = '#8a4a48';
  ctx.fillStyle = '#8a4a48';
  ctx.lineWidth = 3;
  ctx.beginPath();
  switch (shape.mouth) {
    case 'open':
      ctx.ellipse(0, 24, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'frown':
      ctx.moveTo(-10, 27);
      ctx.quadraticCurveTo(0, 20, 10, 27);
      ctx.stroke();
      break;
    case 'flat':
      ctx.moveTo(-9, 24);
      ctx.lineTo(9, 24);
      ctx.stroke();
      break;
    case 'smile':
    default:
      ctx.moveTo(-11, 21);
      ctx.quadraticCurveTo(0, 31, 11, 21);
      ctx.stroke();
      break;
  }

  if (expression === 'happy' || expression === 'excited') {
    ctx.fillStyle = 'rgba(240,138,144,0.36)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 32, 10, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHat(ctx: CanvasRenderingContext2D, look: CharacterLook): void {
  ctx.fillStyle = look.hatColor;
  switch (look.hat) {
    case 'strawHat':
      ctx.beginPath();
      ctx.ellipse(0, -32, 62, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -40, 32, 21, 0, Math.PI, 0);
      ctx.fill();
      break;
    case 'beanie':
      ctx.beginPath();
      ctx.ellipse(0, -22, 47, 36, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-47, -26, 94, 10);
      ctx.beginPath();
      ctx.arc(0, -58, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'capBackwards':
      ctx.beginPath();
      ctx.ellipse(0, -20, 46, 32, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -14, 22, 8, 0, Math.PI, 0);
      ctx.fill();
      break;
    case 'sunVisor':
      ctx.beginPath();
      ctx.ellipse(0, -22, 46, 10, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -20, 56, 16, 0, Math.PI, Math.PI * 1.6);
      ctx.fill();
      break;
    case 'flowerCrown': {
      const colors = ['#f4b5c7', '#f5d66c', '#c9b3f6', '#fdfdfb'];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 44, Math.sin(a) * 34 - 12, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default:
      break;
  }
}

/** Lightens (positive) or darkens (negative) a hex colour. */
function shade(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const mix = (channel: number) =>
    Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
