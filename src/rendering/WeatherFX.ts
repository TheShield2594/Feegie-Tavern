import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { clamp01 } from '@/util/math';
import type { WeatherProfile } from '@/time/WeatherSystem';

const RAIN_COUNT = 2600;
const FIREFLY_COUNT = 90;
const MIST_LAYERS = 3;

/**
 * Everything the weather adds on top of the lit scene: rain streaks, drifting
 * sea mist, and the fireflies that come out at night. All three are single
 * draw calls that scale their visible count rather than being rebuilt.
 */
export class WeatherFX {
  readonly group = new Group();

  private rain: Points;
  private rainMaterial: ShaderMaterial;
  private rainPositions: Float32Array;
  private rainSpeeds: Float32Array;
  private rainOffsets: Float32Array;

  private fireflies: Points;
  private fireflyMaterial: ShaderMaterial;
  private fireflyPositions: Float32Array;
  private fireflySeeds: Float32Array;

  private mist: Mesh[] = [];
  private mistMaterial: ShaderMaterial;

  /** Radius around the camera that precipitation covers. */
  private readonly radius = 30;
  private time = 0;

  constructor() {
    this.group.name = 'WeatherFX';

    // --- Rain ------------------------------------------------------------
    this.rainPositions = new Float32Array(RAIN_COUNT * 3);
    this.rainSpeeds = new Float32Array(RAIN_COUNT);
    this.rainOffsets = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainPositions[i * 3] = (Math.random() * 2 - 1) * this.radius;
      this.rainPositions[i * 3 + 1] = Math.random() * 22;
      this.rainPositions[i * 3 + 2] = (Math.random() * 2 - 1) * this.radius;
      this.rainSpeeds[i] = 16 + Math.random() * 12;
      this.rainOffsets[i] = Math.random();
    }

    const rainGeometry = new BufferGeometry();
    const rainPos = new Float32BufferAttribute(this.rainPositions, 3);
    rainPos.setUsage(DynamicDrawUsage);
    rainGeometry.setAttribute('position', rainPos);
    rainGeometry.setAttribute('aOffset', new Float32BufferAttribute(this.rainOffsets, 1));
    rainGeometry.setDrawRange(0, 0);

    this.rainMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Color('#cfe6f5') },
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
        uStretch: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aOffset;
        uniform float uPixelRatio;
        uniform float uStretch;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Fade drops out as they approach the camera so nothing smears
          // across the lens.
          vFade = smoothstep(1.5, 7.0, -mv.z);
          gl_PointSize = clamp(uPixelRatio * (2.0 + aOffset * 2.0) * uStretch * 120.0 / max(0.5, -mv.z), 1.0, 26.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          // Squash horizontally into a streak rather than a round dot.
          float d = length(vec2(uv.x * 4.5, uv.y));
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * uOpacity * vFade;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });

    this.rain = new Points(rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 14;
    this.group.add(this.rain);

    // --- Fireflies -------------------------------------------------------
    this.fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
    this.fireflySeeds = new Float32Array(FIREFLY_COUNT);
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      this.fireflyPositions[i * 3] = (Math.random() * 2 - 1) * 24;
      this.fireflyPositions[i * 3 + 1] = 0.6 + Math.random() * 2.4;
      this.fireflyPositions[i * 3 + 2] = (Math.random() * 2 - 1) * 24;
      this.fireflySeeds[i] = Math.random() * 100;
    }

    const flyGeometry = new BufferGeometry();
    const flyPos = new Float32BufferAttribute(this.fireflyPositions, 3);
    flyPos.setUsage(DynamicDrawUsage);
    flyGeometry.setAttribute('position', flyPos);
    flyGeometry.setAttribute('aSeed', new Float32BufferAttribute(this.fireflySeeds, 1));
    flyGeometry.setDrawRange(0, 0);

    this.fireflyMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new Color('#ffe98a') },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vPulse;
        void main() {
          vec3 p = position;
          // Wandering drift so each firefly follows its own lazy path.
          p.x += sin(uTime * 0.6 + aSeed) * 0.9;
          p.y += sin(uTime * 0.9 + aSeed * 1.7) * 0.35;
          p.z += cos(uTime * 0.5 + aSeed * 0.8) * 0.9;
          // Slow individual blink, never fully off.
          vPulse = 0.35 + 0.65 * pow(max(0.0, sin(uTime * 1.6 + aSeed * 3.1)), 3.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(uPixelRatio * 90.0 / max(0.5, -mv.z), 2.0, 30.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vPulse;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor, core * core * vPulse * uOpacity);
        }
      `,
    });

    this.fireflies = new Points(flyGeometry, this.fireflyMaterial);
    this.fireflies.frustumCulled = false;
    this.fireflies.renderOrder = 15;
    this.group.add(this.fireflies);

    // --- Mist ------------------------------------------------------------
    this.mistMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new Color('#e6eef2') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }

        void main() {
          vec2 uv = vUv * 5.0;
          float n = noise(uv + vec2(uTime * 0.03, uTime * 0.017));
          n = n * 0.6 + noise(uv * 2.3 - vec2(uTime * 0.021, 0.0)) * 0.4;
          // Fade to nothing at the sheet's edges so the plane is never visible.
          float edge = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x)
                     * smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
          gl_FragColor = vec4(uColor, smoothstep(0.35, 0.85, n) * edge * uOpacity);
        }
      `,
    });

    for (let i = 0; i < MIST_LAYERS; i++) {
      const plane = new Mesh(new PlaneGeometry(90, 90), this.mistMaterial);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.9 + i * 1.5;
      plane.frustumCulled = false;
      plane.renderOrder = 11;
      this.mist.push(plane);
      this.group.add(plane);
    }
  }

  /**
   * @param nightness 0 during the day, 1 at full night — gates the fireflies.
   * @param indoors Suppresses outdoor weather when the player is inside.
   */
  update(
    dt: number,
    weather: WeatherProfile,
    cameraPosition: Vector3,
    nightness: number,
    indoors: boolean,
    season: string,
  ): void {
    this.time += dt;
    this.group.position.set(cameraPosition.x, 0, cameraPosition.z);

    const suppress = indoors ? 0 : 1;

    // --- Rain --------------------------------------------------------------
    const rainAmount = clamp01(weather.precipitation) * suppress;
    const visibleDrops = Math.round(RAIN_COUNT * rainAmount);
    this.rainMaterial.uniforms.uOpacity.value = rainAmount * 0.75;
    this.rainMaterial.uniforms.uStretch.value = 1 + weather.wind * 0.6;
    this.rain.geometry.setDrawRange(0, visibleDrops);

    if (visibleDrops > 0) {
      const windX = weather.wind * 4.5;
      const windZ = weather.wind * 2.2;
      for (let i = 0; i < visibleDrops; i++) {
        const i3 = i * 3;
        this.rainPositions[i3 + 1] -= this.rainSpeeds[i] * dt;
        this.rainPositions[i3] += windX * dt;
        this.rainPositions[i3 + 2] += windZ * dt;
        if (this.rainPositions[i3 + 1] < -1) {
          // Respawn overhead in a fresh spot rather than the same column.
          this.rainPositions[i3] = (Math.random() * 2 - 1) * this.radius;
          this.rainPositions[i3 + 1] = 18 + Math.random() * 6;
          this.rainPositions[i3 + 2] = (Math.random() * 2 - 1) * this.radius;
        } else if (Math.abs(this.rainPositions[i3]) > this.radius) {
          this.rainPositions[i3] -= Math.sign(this.rainPositions[i3]) * this.radius * 2;
        } else if (Math.abs(this.rainPositions[i3 + 2]) > this.radius) {
          this.rainPositions[i3 + 2] -= Math.sign(this.rainPositions[i3 + 2]) * this.radius * 2;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // --- Fireflies ---------------------------------------------------------
    // Fireflies only make sense on mild, dry nights.
    const fireflyMood = clamp01(nightness * 1.4)
      * (1 - clamp01(weather.precipitation * 2))
      * (season === 'Winter' ? 0.15 : 1)
      * suppress;
    this.fireflyMaterial.uniforms.uTime.value = this.time;
    this.fireflyMaterial.uniforms.uOpacity.value = fireflyMood;
    this.fireflies.geometry.setDrawRange(0, fireflyMood > 0.02 ? FIREFLY_COUNT : 0);

    // --- Mist --------------------------------------------------------------
    const mistAmount = clamp01((weather.fog - 1.2) / 2.4) * suppress;
    this.mistMaterial.uniforms.uTime.value = this.time;
    this.mistMaterial.uniforms.uOpacity.value = mistAmount * 0.5;
    for (const plane of this.mist) plane.visible = mistAmount > 0.01;
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rainMaterial.dispose();
    this.fireflies.geometry.dispose();
    this.fireflyMaterial.dispose();
    for (const m of this.mist) m.geometry.dispose();
    this.mistMaterial.dispose();
  }
}
