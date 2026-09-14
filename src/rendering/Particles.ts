import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

export interface ParticleOptions {
  position: Vector3;
  velocity?: Vector3;
  color?: string | Color;
  size?: number;
  /** Size at the end of life, relative to `size`. */
  endScale?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** Additive blending for sparkles and glints. */
  additive?: boolean;
  /** Randomised spread applied to the initial velocity. */
  spread?: number;
  spin?: number;
}

export type BurstPreset =
  | 'dirt'
  | 'leaves'
  | 'splash'
  | 'sparkle'
  | 'petals'
  | 'dust'
  | 'waterRing'
  | 'woodChips'
  | 'stoneChips'
  | 'hearts'
  | 'note';

interface Particle {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  endScale: number;
  gravity: number;
  drag: number;
  r: number; g: number; b: number;
}

const MAX_PARTICLES = 900;

/**
 * One pooled particle buffer for the whole game. Two Points objects (normal and
 * additive) cover every effect, so a burst costs no allocations and no extra
 * draw calls.
 */
export class ParticleSystem {
  readonly normalPoints: Points;
  readonly additivePoints: Points;

  private normal = this.createPool(MAX_PARTICLES);
  private additive = this.createPool(MAX_PARTICLES / 2);

  constructor() {
    this.normalPoints = this.createPoints(this.normal, false);
    this.additivePoints = this.createPoints(this.additive, true);
  }

  private createPool(count: number) {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        age: 0, life: 1, size: 1, endScale: 0, gravity: 0, drag: 0,
        r: 1, g: 1, b: 1,
      });
    }
    return {
      particles,
      positions: new Float32Array(count * 3),
      colors: new Float32Array(count * 3),
      sizes: new Float32Array(count),
      alphas: new Float32Array(count),
      cursor: 0,
      geometry: null as BufferGeometry | null,
    };
  }

  private createPoints(pool: ReturnType<ParticleSystem['createPool']>, additive: boolean): Points {
    const geometry = new BufferGeometry();
    // BufferAttribute, not Float32BufferAttribute: the latter copies the array
    // it is handed, and the simulation writes the pool's arrays every frame.
    // With a copy the uploaded buffer never changes and nothing animates.
    const position = new BufferAttribute(pool.positions, 3);
    const color = new BufferAttribute(pool.colors, 3);
    const size = new BufferAttribute(pool.sizes, 1);
    const alpha = new BufferAttribute(pool.alphas, 1);
    position.setUsage(DynamicDrawUsage);
    color.setUsage(DynamicDrawUsage);
    size.setUsage(DynamicDrawUsage);
    alpha.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('aColor', color);
    geometry.setAttribute('aSize', size);
    geometry.setAttribute('aAlpha', alpha);
    geometry.setDrawRange(0, 0);
    pool.geometry = geometry;

    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: { uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Perspective-correct point size, clamped so nearby sparks do not
          // blow out to full-screen quads.
          gl_PointSize = clamp(aSize * uPixelRatio * 220.0 / max(0.1, -mv.z), 1.0, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          // Soft round falloff with a brighter core.
          float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });

    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 12;
    return points;
  }

  private spawn(pool: ReturnType<ParticleSystem['createPool']>, options: ParticleOptions): void {
    const { particles } = pool;
    // Ring-buffer allocation: the oldest particle is recycled if all are busy,
    // which keeps heavy bursts bounded instead of dropping the newest effect.
    let index = -1;
    for (let i = 0; i < particles.length; i++) {
      const candidate = (pool.cursor + i) % particles.length;
      if (!particles[candidate].active) {
        index = candidate;
        break;
      }
    }
    if (index < 0) index = pool.cursor % particles.length;
    pool.cursor = (index + 1) % particles.length;

    const p = particles[index];
    const spread = options.spread ?? 0;
    const color = new Color(options.color ?? '#ffffff');

    p.active = true;
    p.x = options.position.x;
    p.y = options.position.y;
    p.z = options.position.z;
    const v = options.velocity ?? new Vector3();
    p.vx = v.x + (Math.random() * 2 - 1) * spread;
    p.vy = v.y + (Math.random() * 2 - 1) * spread;
    p.vz = v.z + (Math.random() * 2 - 1) * spread;
    p.age = 0;
    p.life = options.life ?? 1;
    p.size = options.size ?? 0.12;
    p.endScale = options.endScale ?? 0;
    p.gravity = options.gravity ?? -9;
    p.drag = options.drag ?? 1.2;
    p.r = color.r; p.g = color.g; p.b = color.b;
  }

  emit(options: ParticleOptions): void {
    this.spawn(options.additive ? this.additive : this.normal, options);
  }

  /** Fires a named preset at a point. Presets keep call sites short and consistent. */
  burst(preset: BurstPreset, at: Vector3, strength = 1): void {
    const p = at.clone();
    switch (preset) {
      case 'dirt':
        for (let i = 0; i < Math.round(12 * strength); i++) {
          this.emit({
            position: p, color: i % 3 === 0 ? '#7a5537' : '#a67c52',
            velocity: new Vector3(0, 2.6 + Math.random() * 1.8, 0), spread: 1.9,
            size: 0.07 + Math.random() * 0.06, life: 0.55 + Math.random() * 0.3, gravity: -13,
          });
        }
        break;
      case 'woodChips':
        for (let i = 0; i < Math.round(10 * strength); i++) {
          this.emit({
            position: p, color: i % 2 ? '#c49a6c' : '#8a6238',
            velocity: new Vector3(0, 3.1 + Math.random() * 1.6, 0), spread: 2.4,
            size: 0.06 + Math.random() * 0.05, life: 0.6, gravity: -14,
          });
        }
        break;
      case 'stoneChips':
        for (let i = 0; i < Math.round(11 * strength); i++) {
          this.emit({
            position: p, color: i % 2 ? '#b4bcb7' : '#7c8681',
            velocity: new Vector3(0, 3.4 + Math.random() * 1.5, 0), spread: 2.6,
            size: 0.05 + Math.random() * 0.05, life: 0.55, gravity: -15,
          });
        }
        break;
      case 'leaves':
        for (let i = 0; i < Math.round(9 * strength); i++) {
          this.emit({
            position: p, color: ['#7ec46a', '#5aa356', '#a8d97a'][i % 3],
            velocity: new Vector3(0, 0.6, 0), spread: 1.4,
            size: 0.13, life: 1.6 + Math.random(), gravity: -1.6, drag: 2.6,
          });
        }
        break;
      case 'petals':
        for (let i = 0; i < Math.round(8 * strength); i++) {
          this.emit({
            position: p, color: ['#f4b5c7', '#fdfdfb', '#f5d66c'][i % 3],
            velocity: new Vector3(0, 0.9, 0), spread: 1.1,
            size: 0.1, life: 2.2, gravity: -1.1, drag: 3,
          });
        }
        break;
      case 'splash':
        for (let i = 0; i < Math.round(16 * strength); i++) {
          const angle = (i / (16 * strength)) * Math.PI * 2;
          this.emit({
            position: p, color: i % 4 === 0 ? '#f2fbff' : '#a8ddf0',
            velocity: new Vector3(Math.cos(angle) * 1.9, 3.2 + Math.random() * 1.6, Math.sin(angle) * 1.9),
            spread: 0.4, size: 0.08 + Math.random() * 0.05, life: 0.6, gravity: -14,
          });
        }
        break;
      case 'waterRing':
        for (let i = 0; i < Math.round(14 * strength); i++) {
          const angle = (i / 14) * Math.PI * 2;
          this.emit({
            position: p, color: '#dff4fb', additive: true,
            velocity: new Vector3(Math.cos(angle) * 2.4, 0.25, Math.sin(angle) * 2.4),
            size: 0.11, endScale: 0.2, life: 0.7, gravity: 0, drag: 2.8,
          });
        }
        break;
      case 'sparkle':
        for (let i = 0; i < Math.round(14 * strength); i++) {
          this.emit({
            position: p, color: ['#fff3c4', '#ffd9a0', '#ffffff'][i % 3], additive: true,
            velocity: new Vector3(0, 1.6 + Math.random(), 0), spread: 1.5,
            size: 0.1 + Math.random() * 0.09, life: 0.85, gravity: -2.2, drag: 1.8,
          });
        }
        break;
      case 'hearts':
        for (let i = 0; i < Math.round(6 * strength); i++) {
          this.emit({
            position: p, color: '#f2879b', additive: false,
            velocity: new Vector3(0, 1.5, 0), spread: 0.5,
            size: 0.16, life: 1.5, gravity: 0.6, drag: 2.4,
          });
        }
        break;
      case 'note':
        for (let i = 0; i < Math.round(4 * strength); i++) {
          this.emit({
            position: p, color: '#cfe4f5',
            velocity: new Vector3(0, 1.1, 0), spread: 0.4,
            size: 0.12, life: 1.6, gravity: 0.4, drag: 2.2,
          });
        }
        break;
      case 'dust':
      default:
        for (let i = 0; i < Math.round(7 * strength); i++) {
          this.emit({
            position: p, color: '#dbcdb2',
            velocity: new Vector3(0, 0.7, 0), spread: 0.9,
            size: 0.14, endScale: 2.2, life: 0.8, gravity: 0.4, drag: 3.2,
          });
        }
        break;
    }
  }

  update(dt: number): void {
    // Clamp so a tab that was backgrounded does not teleport every particle.
    this.lastDt = Math.min(dt, 1 / 20);
    this.stepPool(this.normal);
    this.stepPool(this.additive);
  }

  private stepPool(pool: ReturnType<ParticleSystem['createPool']>): void {
    const { particles, positions, colors, sizes, alphas, geometry } = pool;
    if (!geometry) return;
    let write = 0;
    const dt = this.lastDt;

    for (const p of particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = p.age / p.life;
      const i3 = write * 3;
      positions[i3] = p.x;
      positions[i3 + 1] = p.y;
      positions[i3 + 2] = p.z;
      colors[i3] = p.r;
      colors[i3 + 1] = p.g;
      colors[i3 + 2] = p.b;
      sizes[write] = p.size * (1 + (p.endScale - 1) * t);
      // Quick fade-in then a long tail out, so bursts read as a pop.
      alphas[write] = Math.min(1, t * 8) * (1 - t * t);
      write += 1;
    }

    geometry.setDrawRange(0, write);
    if (write > 0) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    }
  }

  private lastDt = 1 / 60;

  get activeCount(): number {
    let n = 0;
    for (const p of this.normal.particles) if (p.active) n++;
    for (const p of this.additive.particles) if (p.active) n++;
    return n;
  }

  dispose(): void {
    this.normalPoints.geometry.dispose();
    this.additivePoints.geometry.dispose();
    (this.normalPoints.material as ShaderMaterial).dispose();
    (this.additivePoints.material as ShaderMaterial).dispose();
  }
}
