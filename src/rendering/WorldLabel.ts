import {
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';
import { clamp01, damp, smoothstep } from '@/util/math';

/**
 * World-space labels and speech bubbles drawn onto sprites.
 *
 * These are rendered in the scene rather than as HTML so they sit *behind* a
 * lamp post or a doorway the way a real sign would, fade with distance like
 * everything else, and never look like a browser element floating over the
 * game. Both share one canvas painter and the same fade-in/pop-out motion.
 */

const FONT = '"Nunito", "Quicksand", "Avenir Next", system-ui, sans-serif';

interface PainterOptions {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** Draws a canvas with `draw` and wraps it as a linearly filtered sRGB texture. */
function paint({ width, height, draw }: PainterOptions): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Traces a rounded rectangle path; the caller fills or strokes it. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Redraws once the UI font has arrived, so the first label is not system-ui. */
function whenFontReady(redraw: () => void): void {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  if (fonts.check(`700 32px ${FONT}`)) return;
  void fonts.load(`700 32px ${FONT}`).then(redraw).catch(() => undefined);
}

export interface NameplateOptions {
  text: string;
  /** Accent swatch on the left — a villager's outfit colour, a player's team. */
  accent?: string;
  /** Sub-line under the name, e.g. a title. */
  subtitle?: string;
}

/**
 * A small pill with a name in it, hovering above a character's head.
 *
 * Fades out past `farDistance` so the square never fills with tags, and fades
 * out again when the camera is right on top of the character, where the tag
 * would cover their face.
 */
export class Nameplate {
  readonly sprite: Sprite;
  private material: SpriteMaterial;
  private opacity = 0;
  private targetOpacity = 0;
  farDistance = 16;
  visibleOverride: boolean | null = null;

  /** Renders the plate once now and again when the UI font finishes loading. */
  constructor(private options: NameplateOptions) {
    this.material = new SpriteMaterial({
      map: this.render(),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.name = `Nameplate_${options.text}`;
    this.sprite.renderOrder = 20;
    this.fit();
    whenFontReady(() => {
      this.material.map?.dispose();
      this.material.map = this.render();
      this.fit();
    });
  }

  private lastSize = { w: 1, h: 1 };

  /** Paints the pill, accent dot, name and optional subtitle onto a fresh texture. */
  private render(): CanvasTexture {
    const { text, accent, subtitle } = this.options;
    const scratch = document.createElement('canvas').getContext('2d')!;
    scratch.font = `800 34px ${FONT}`;
    const textWidth = scratch.measureText(text).width;
    scratch.font = `700 22px ${FONT}`;
    const subWidth = subtitle ? scratch.measureText(subtitle).width : 0;
    const padX = 26;
    const swatch = accent ? 22 : 0;
    const width = Math.ceil(Math.max(textWidth, subWidth) + padX * 2 + swatch + 8);
    const height = subtitle ? 84 : 58;
    this.lastSize = { w: width, h: height };

    return paint({
      width,
      height,
      draw: (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        // Soft drop shadow, then the paper pill.
        ctx.shadowColor = 'rgba(20, 26, 30, 0.35)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        roundRect(ctx, 4, 4, w - 8, h - 10, (h - 10) / 2);
        ctx.fillStyle = 'rgba(38, 48, 52, 0.78)';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        // Hairline highlight along the top edge.
        roundRect(ctx, 4, 4, w - 8, h - 10, (h - 10) / 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 2;
        ctx.stroke();

        let x = padX;
        if (accent) {
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(x + 4, (h - 6) / 2, 9, 0, Math.PI * 2);
          ctx.fill();
          x += swatch + 8;
        }
        ctx.fillStyle = '#fbf5e9';
        ctx.textBaseline = 'middle';
        ctx.font = `800 34px ${FONT}`;
        ctx.fillText(text, x, subtitle ? 30 : (h - 6) / 2 + 1);
        if (subtitle) {
          ctx.fillStyle = 'rgba(251, 245, 233, 0.7)';
          ctx.font = `700 22px ${FONT}`;
          ctx.fillText(subtitle, x, 58);
        }
      },
    });
  }

  /** Sizes the sprite so canvas pixels map to a fixed world size. */
  private fit(): void {
    // One canvas pixel ≈ 5 mm in the world, which puts a name at roughly the
    // height of the character's head from the default camera.
    const scale = 0.0058;
    this.sprite.scale.set(this.lastSize.w * scale, this.lastSize.h * scale, 1);
  }

  /** Repaints with a new name or subtitle; a no-op when nothing changed. */
  setText(text: string, subtitle?: string): void {
    if (text === this.options.text && subtitle === this.options.subtitle) return;
    this.options = { ...this.options, text, subtitle };
    this.material.map?.dispose();
    this.material.map = this.render();
    this.fit();
  }

  /** @param distance Metres from the viewer's character to this one. */
  update(dt: number, distance: number): void {
    const wanted = this.visibleOverride ?? (distance < this.farDistance && distance > 1.6);
    this.targetOpacity = wanted ? smoothstep(this.farDistance, this.farDistance * 0.7, distance) * 0.94 : 0;
    this.opacity = damp(this.opacity, this.targetOpacity, 0.08, dt);
    this.material.opacity = this.opacity;
    this.sprite.visible = this.opacity > 0.01;
  }

  /** Releases the plate texture and material. */
  dispose(): void {
    this.material.map?.dispose();
    this.material.dispose();
  }
}

export type EmoteKind = 'exclaim' | 'question' | 'heart' | 'note' | 'dots' | 'sleep' | 'sparkle' | 'fish' | 'happy';

const EMOTE_CACHE = new Map<EmoteKind, CanvasTexture>();

/** The bubble texture for an emote kind, painted once and cached for every character. */
function emoteTexture(kind: EmoteKind): CanvasTexture {
  let texture = EMOTE_CACHE.get(kind);
  if (texture) return texture;
  texture = paint({
    width: 128,
    height: 128,
    draw: (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      // Speech-bubble body with a tail bottom-left.
      ctx.shadowColor = 'rgba(20, 26, 30, 0.3)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#efe6d3';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 - 6, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w / 2 - 22, h / 2 + 26);
      ctx.lineTo(w / 2 - 12, h / 2 + 52);
      ctx.lineTo(w / 2 + 2, h / 2 + 30);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = w / 2;
      const cy = h / 2 - 6;
      switch (kind) {
        case 'exclaim':
          ctx.fillStyle = '#d9705f';
          ctx.font = `900 74px ${FONT}`;
          ctx.fillText('!', cx, cy + 2);
          break;
        case 'question':
          ctx.fillStyle = '#2f8fa8';
          ctx.font = `900 70px ${FONT}`;
          ctx.fillText('?', cx, cy + 2);
          break;
        case 'heart':
          ctx.fillStyle = '#e0728a';
          drawHeart(ctx, cx, cy + 2, 30);
          break;
        case 'note':
          ctx.fillStyle = '#2f8fa8';
          ctx.font = `900 62px ${FONT}`;
          ctx.fillText('♪', cx, cy);
          break;
        case 'dots':
          ctx.fillStyle = '#5c6a6b';
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.arc(cx + i * 20, cy + 4, 7, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case 'sleep':
          ctx.fillStyle = '#8a5f96';
          ctx.font = `900 46px ${FONT}`;
          ctx.fillText('z', cx - 12, cy + 12);
          ctx.font = `900 30px ${FONT}`;
          ctx.fillText('z', cx + 16, cy - 14);
          break;
        case 'sparkle':
          ctx.fillStyle = '#e8a93c';
          drawStar(ctx, cx, cy, 30, 12);
          break;
        case 'fish':
          ctx.fillStyle = '#2f8fa8';
          ctx.beginPath();
          ctx.ellipse(cx - 4, cy, 26, 15, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + 18, cy);
          ctx.lineTo(cx + 36, cy - 14);
          ctx.lineTo(cx + 36, cy + 14);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#fbf5e9';
          ctx.beginPath();
          ctx.arc(cx - 16, cy - 4, 3.5, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'happy':
        default:
          ctx.strokeStyle = '#e8a93c';
          ctx.lineWidth = 7;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(cx, cy - 4, 24, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          ctx.fillStyle = '#e8a93c';
          for (const dx of [-13, 13]) {
            ctx.beginPath();
            ctx.arc(cx + dx, cy - 16, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
      }
    },
  });
  EMOTE_CACHE.set(kind, texture);
  return texture;
}

/** Fills a heart centred on `cx, cy`. */
function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.8);
  ctx.bezierCurveTo(cx - size * 1.4, cy - size * 0.2, cx - size * 0.6, cy - size * 1.1, cx, cy - size * 0.4);
  ctx.bezierCurveTo(cx + size * 0.6, cy - size * 1.1, cx + size * 1.4, cy - size * 0.2, cx, cy + size * 0.8);
  ctx.closePath();
  ctx.fill();
}

/** Fills an eight-point sparkle centred on `cx, cy`. */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * A speech bubble that pops in over a character, holds, and shrinks away.
 * One per character; showing a new emote replaces the old one.
 */
export class EmoteBubble {
  readonly sprite: Sprite;
  private material: SpriteMaterial;
  private life = 0;
  private duration = 0;
  private age = 0;
  private sticky = false;
  private kind: EmoteKind | null = null;

  /** Creates the sprite hidden; `show` gives it a texture. */
  constructor() {
    // Tone-mapped like the rest of the scene: an unmapped near-white sprite
    // sails past the bloom threshold and turns into a glowing blob at night.
    this.material = new SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
    this.sprite = new Sprite(this.material);
    this.sprite.name = 'Emote';
    this.sprite.renderOrder = 21;
    this.sprite.scale.set(0.7, 0.7, 1);
    this.sprite.visible = false;
  }

  /**
   * @param duration Seconds to hold. `Infinity` keeps it until `hide()`.
   */
  show(kind: EmoteKind, duration = 1.6): void {
    if (this.kind !== kind) {
      this.material.map = emoteTexture(kind);
      this.material.needsUpdate = true;
      this.kind = kind;
    }
    this.sticky = !Number.isFinite(duration);
    this.duration = this.sticky ? 1 : duration;
    this.life = 0;
    this.age = 0;
    this.sprite.visible = true;
  }

  /** Lets a sticky bubble pop out instead of vanishing. */
  hide(): void {
    if (!this.sprite.visible) return;
    // Let the pop-out play from wherever the hold is.
    this.sticky = false;
    this.duration = Math.min(this.duration, this.age + 0.2);
  }

  /** The emote on screen, or null while hidden. */
  get current(): EmoteKind | null {
    return this.sprite.visible ? this.kind : null;
  }

  /** Advances the pop-in, hold, bob and pop-out. */
  update(dt: number): void {
    if (!this.sprite.visible) return;
    this.age += dt;
    this.life = this.sticky ? Math.min(this.life + dt, 0.3) : this.age;
    const popIn = clamp01(this.age / 0.22);
    const overshoot = 1 + Math.sin(popIn * Math.PI) * 0.25;
    const holdEnd = this.sticky ? Infinity : this.duration;
    const popOut = this.sticky ? 0 : clamp01((this.age - holdEnd) / 0.18);
    const scale = 0.7 * popIn * overshoot * (1 - popOut);
    // A gentle bob while it holds, so a sticky marker still feels alive.
    const bob = Math.sin(this.age * 4.2) * 0.03;
    this.sprite.scale.set(scale, scale, 1);
    this.sprite.position.y = this.baseY + bob;
    this.material.opacity = popIn * (1 - popOut);
    if (!this.sticky && this.age > holdEnd + 0.18) this.sprite.visible = false;
  }

  /** Height above the character's origin. */
  baseY = 2.2;

  /** Releases the sprite material; emote textures are shared and stay cached. */
  dispose(): void {
    this.material.dispose();
  }
}
