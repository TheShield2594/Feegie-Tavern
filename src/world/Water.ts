import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';
import { PALETTE } from '@/rendering/palette';
import { ISLAND_HALF, SEA_LEVEL, terrainHeight } from './heightfield';

/**
 * Ocean and creek surface.
 *
 * Depth is read from a baked heightfield texture rather than the scene depth
 * buffer, which keeps the shader independent of the render pipeline, makes
 * shoreline foam exact, and costs one 256² single-channel texture.
 */
export class Water {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private depthTexture: DataTexture;

  private static readonly DEPTH_RES = 512;
  /** Terrain heights are encoded into one byte across this range, in metres. */
  private static readonly DEPTH_MIN = -12;
  private static readonly DEPTH_MAX = 6;

  constructor(extent = ISLAND_HALF * 2 + 260) {
    this.depthTexture = Water.bakeDepthTexture();

    this.material = new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new Color(PALETTE.water.shallow) },
        uMid: { value: new Color(PALETTE.water.mid) },
        uDeep: { value: new Color(PALETTE.water.deep) },
        uFoam: { value: new Color(PALETTE.water.foam) },
        uSkyColor: { value: new Color('#cfe8f5') },
        uSunDirection: { value: new Vector3(0.4, 0.7, 0.3) },
        uSunColor: { value: new Color('#fff4dc') },
        uDepthMap: { value: this.depthTexture },
        uMapExtent: { value: ISLAND_HALF * 2 + 40 },
        uDepthRange: { value: new Vector3(Water.DEPTH_MIN, Water.DEPTH_MAX - Water.DEPTH_MIN, 0) },
        uWind: { value: 0.4 },
        uChoppiness: { value: 0.35 },
        uOpacity: { value: 0.94 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uWind;
        uniform float uChoppiness;
        uniform sampler2D uDepthMap;
        uniform float uMapExtent;
        uniform vec3 uDepthRange;

        varying vec3 vWorldPos;
        varying float vDepth;
        varying vec3 vNormal;

        // Terrain height is stored as a plain 8-bit channel rather than a float
        // texture, because float textures are not filterable everywhere.
        float sampleGround(vec2 world) {
          vec2 uv = world / uMapExtent + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return uDepthRange.x;
          return uDepthRange.x + texture2D(uDepthMap, uv).r * uDepthRange.y;
        }

        // Two crossing swells plus a fine ripple. Amplitude is scaled down in
        // the shallows so waves do not poke through the sand.
        vec3 waveOffset(vec2 p, float shore) {
          float t = uTime;
          float a = sin(p.x * 0.085 + t * 0.85) * cos(p.y * 0.062 - t * 0.6);
          float b = sin((p.x * 0.041 - p.y * 0.052) + t * 1.25);
          float c = sin(p.x * 0.31 + t * 2.3) * cos(p.y * 0.28 - t * 1.9);
          float amp = mix(0.06, 0.42, shore) * (0.55 + uWind * 0.9);
          return vec3(0.0, (a * 0.55 + b * 0.32 + c * 0.13) * amp * uChoppiness * 3.0, 0.0);
        }

        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          float ground = sampleGround(world.xz);
          float depth = max(0.0, ${SEA_LEVEL.toFixed(1)} - ground);
          vDepth = depth;

          float shore = smoothstep(0.0, 3.2, depth);
          vec3 offset = waveOffset(world.xz, shore);
          world.xyz += offset;

          // Analytic-ish normal from two nearby wave samples.
          float e = 1.6;
          float hx = waveOffset(world.xz + vec2(e, 0.0), shore).y - offset.y;
          float hz = waveOffset(world.xz + vec2(0.0, e), shore).y - offset.y;
          vNormal = normalize(vec3(-hx, e, -hz));

          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uMid;
        uniform vec3 uDeep;
        uniform vec3 uFoam;
        uniform vec3 uSkyColor;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uWind;
        uniform float uOpacity;

        varying vec3 vWorldPos;
        varying float vDepth;
        varying vec3 vNormal;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }

        void main() {
          if (vDepth <= 0.001) discard;

          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 normal = normalize(vNormal);

          // Depth ramp: turquoise over sand, deepening to navy off the shelf.
          vec3 color = mix(uShallow, uMid, smoothstep(0.15, 1.7, vDepth));
          color = mix(color, uDeep, smoothstep(1.5, 5.5, vDepth));

          // Fresnel sky reflection — the single biggest cue that this is water.
          float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.4);
          color = mix(color, uSkyColor, fresnel * 0.62);

          // Sun glitter: a tight specular lobe broken up by noise so it reads
          // as a thousand little facets rather than one mirror.
          vec3 halfway = normalize(normalize(uSunDirection) + viewDir);
          float spec = pow(max(dot(normal, halfway), 0.0), 180.0);
          float sparkleNoise = noise(vWorldPos.xz * 2.4 + uTime * 0.6);
          color += uSunColor * spec * (0.7 + sparkleNoise * 1.6);

          // Shoreline foam: a band that follows the depth contour, chewed up by
          // noise and pushed in and out with the swell.
          float tideOffset = sin(uTime * 0.55 + vWorldPos.x * 0.05) * 0.12;
          float foamBand = 1.0 - smoothstep(0.02, 0.48 + tideOffset, vDepth);
          float foamNoise = noise(vWorldPos.xz * 1.5 + vec2(uTime * 0.35, uTime * 0.22));
          float foamNoise2 = noise(vWorldPos.xz * 4.1 - vec2(uTime * 0.5, 0.0));
          float foam = foamBand * smoothstep(0.28, 0.78, foamNoise * 0.6 + foamNoise2 * 0.4);
          // A hard lip right at the waterline.
          foam += (1.0 - smoothstep(0.0, 0.14, vDepth)) * 0.75;
          color = mix(color, uFoam, clamp(foam, 0.0, 1.0) * 0.92);

          // Streaks of surface texture out in open water.
          float streak = noise(vWorldPos.xz * 0.35 + vec2(uTime * 0.08, 0.0));
          color += (streak - 0.5) * 0.05 * uWind;

          // The shallows are translucent so the sand shows through.
          float alpha = mix(0.5, uOpacity, smoothstep(0.0, 1.2, vDepth));
          alpha = max(alpha, clamp(foam, 0.0, 1.0));

          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    // A fairly dense grid: the vertex waves need geometry to displace.
    const geometry = new PlaneGeometry(extent, extent, 200, 200);
    geometry.rotateX(-Math.PI / 2);

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'Ocean';
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.renderOrder = 4;
    this.mesh.userData.noFade = true;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
  }

  /** Bakes terrain height into an 8-bit texture the water shader can sample. */
  private static bakeDepthTexture(): DataTexture {
    const res = Water.DEPTH_RES;
    const extent = ISLAND_HALF * 2 + 40;
    const span = Water.DEPTH_MAX - Water.DEPTH_MIN;
    const data = new Uint8Array(res * res * 4);

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const wx = (x / (res - 1) - 0.5) * extent;
        const wz = (y / (res - 1) - 0.5) * extent;
        const height = terrainHeight(wx, wz);
        const normalized = Math.min(1, Math.max(0, (height - Water.DEPTH_MIN) / span));
        const index = (y * res + x) * 4;
        const byte = Math.round(normalized * 255);
        data[index] = byte;
        data[index + 1] = byte;
        data[index + 2] = byte;
        data[index + 3] = 255;
      }
    }

    const texture = new DataTexture(data, res, res, RGBAFormat, UnsignedByteType);
    texture.colorSpace = NoColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  update(time: number, sunDirection: Vector3, sunColor: Color, skyColor: Color, wind: number, choppiness: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uSunDirection.value as Vector3).copy(sunDirection);
    (u.uSunColor.value as Color).copy(sunColor);
    (u.uSkyColor.value as Color).copy(skyColor);
    u.uWind.value = wind;
    u.uChoppiness.value = choppiness;
  }

  /** Keeps the ocean centred so it always reaches the horizon. */
  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  /** Surface height at a point, matching the vertex shader closely enough for gameplay. */
  surfaceHeight(x: number, z: number, time: number): number {
    const a = Math.sin(x * 0.085 + time * 0.85) * Math.cos(z * 0.062 - time * 0.6);
    const b = Math.sin(x * 0.041 - z * 0.052 + time * 1.25);
    return SEA_LEVEL + (a * 0.55 + b * 0.32) * 0.3;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthTexture.dispose();
  }
}
