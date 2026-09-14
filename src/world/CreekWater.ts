import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { PALETTE } from '@/rendering/palette';
import { CREEK, SEA_LEVEL, creekSurfaceHeight, projectOntoCreek, terrainHeight } from './heightfield';

/** Metres between cross-sections along the stream. */
const STEP = 1.1;
/** Half-width of the ribbon. Wider than the wet channel; the edges fade out. */
const HALF_WIDTH = 7;
/** Cross-samples per section. Odd, so one sits on the centreline. */
const COLUMNS = 15;

/**
 * The creek's water surface.
 *
 * The ocean is one flat plane that discards itself wherever the seabed is above
 * sea level, which is every metre of a stream running twenty metres up a ridge.
 * So the creek gets its own ribbon, meshed along the channel the heightfield
 * carves and standing at the level `creekSurfaceHeight` puts it.
 *
 * Each vertex carries how deep the water is over it, how far down the stream it
 * sits and how fast the surface is dropping there, which is enough for the
 * shader to shade a pool differently from a riffle and to fade the whole thing
 * out where the creek meets the sea and the ocean takes over.
 */
export class CreekWater {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor() {
    const geometry = CreekWater.buildRibbon();

    this.material = new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new Color('#7fbfa8') },
        uDeep: { value: new Color(PALETTE.water.mid) },
        uFoam: { value: new Color(PALETTE.water.foam) },
        uSkyColor: { value: new Color('#cfe8f5') },
        uSunDirection: { value: new Vector3(0.4, 0.7, 0.3) },
        uSunColor: { value: new Color('#fff4dc') },
      },
      vertexShader: /* glsl */ `
        attribute float aDepth;
        attribute float aFlow;
        attribute float aRush;

        varying vec3 vWorldPos;
        varying float vDepth;
        varying float vFlow;
        varying float vRush;

        void main() {
          vDepth = aDepth;
          vFlow = aFlow;
          vRush = aRush;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uFoam;
        uniform vec3 uSkyColor;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;

        varying vec3 vWorldPos;
        varying float vDepth;
        varying float vFlow;
        varying float vRush;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }

        // Two crossing bands: a slow swell and a fine chop, both running
        // downstream.
        float rippleAt(vec2 p, float drift) {
          return noise(p * 2.6 + vec2(0.0, -drift * 2.0)) * 0.6
               + noise(p * 6.1 - vec2(drift * 3.4, 0.0)) * 0.4;
        }

        void main() {
          if (vDepth <= 0.004) discard;

          // Downstream drift: the ripple fields scroll seaward, never upstream.
          float drift = uTime * 0.5;
          vec2 p = vWorldPos.xz;
          float ripple = rippleAt(p, drift);

          // A surface normal from the ripple field's own gradient. Without one
          // there is nothing for a specular term to be specular *about*: a
          // highlight computed from the sun and the eye alone is constant over
          // the whole ribbon, and paints the noise pattern across every metre
          // of the creek at once instead of glinting off the odd wavelet.
          float e = 0.25;
          vec3 normal = normalize(vec3(
            (ripple - rippleAt(p + vec2(e, 0.0), drift)) * 1.6,
            e,
            (ripple - rippleAt(p + vec2(0.0, e), drift)) * 1.6
          ));

          vec3 color = mix(uShallow, uDeep, smoothstep(0.1, 0.85, vDepth));

          // The stream takes on a little of the cove as it nears the mouth.
          color = mix(color, uDeep, smoothstep(0.7, 1.0, vFlow) * 0.35);

          // Gravel shows through the shallows, so lighten them and let the
          // ripple modulate what reads as a stony bed rather than open water.
          color += (ripple - 0.5) * 0.14 * (1.0 - smoothstep(0.1, 0.7, vDepth));

          // Sky in the surface, strongest at glancing angles.
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
          color = mix(color, uSkyColor, fresnel * 0.28);

          vec3 halfway = normalize(normalize(uSunDirection) + viewDir);
          float spec = pow(max(dot(normal, halfway), 0.0), 90.0);
          color += uSunColor * spec * 0.55;

          // White water: a thin lace right at the waterline, and standing riffles
          // where the bed tips steeply enough for the stream to break over it.
          // Both are kept narrow on purpose — a broad band of foam down a
          // ten-metre channel reads as surf, and this is a creek.
          float bank = 1.0 - smoothstep(0.01, 0.12, vDepth);
          float riffle = smoothstep(0.24, 0.62, vRush) * smoothstep(0.62, 0.92, ripple);
          float foam = clamp(bank * (0.3 + ripple * 0.45) + riffle * 0.5, 0.0, 1.0);
          color = mix(color, uFoam, foam * 0.7);

          // Fade into the sea rather than meeting it as a step: near the mouth
          // the creek surface settles onto sea level and the ocean takes over.
          float seaFade = smoothstep(0.04, 0.4, vWorldPos.y - ${SEA_LEVEL.toFixed(1)});

          // Deliberately thin. This is ankle-to-knee water over a gravel bed:
          // if you cannot see the stones — or your own feet — through it, it
          // reads as a painted blue surface rather than as a stream.
          float alpha = mix(0.18, 0.58, smoothstep(0.0, 0.75, vDepth));
          alpha = max(alpha, foam * 0.8);
          gl_FragColor = vec4(color, alpha * seaFade);
        }
      `,
    });

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'Creek';
    this.mesh.renderOrder = 3;
    this.mesh.userData.noFade = true;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
  }

  /**
   * Meshes the channel: a strip of quads following the centreline, each row
   * level across the stream because the water is.
   */
  private static buildRibbon(): BufferGeometry {
    // Resample the control polyline at a fixed step so the ribbon is evenly
    // tessellated regardless of how far apart the control points sit.
    const spine: { x: number; z: number; y: number }[] = [];
    for (let i = 0; i < CREEK.points.length - 1; i++) {
      const a = CREEK.points[i];
      const b = CREEK.points[i + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.round(length / STEP));
      // The last point of each segment is the first of the next; skip it
      // except on the final segment, or every joint gets a doubled row.
      const limit = i === CREEK.points.length - 2 ? steps : steps - 1;
      for (let s = 0; s <= limit; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        spine.push({ x, z, y: creekSurfaceHeight(x, z) });
      }
    }

    const positions: number[] = [];
    const depths: number[] = [];
    const flows: number[] = [];
    const rushes: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < spine.length; i++) {
      const here = spine[i];
      const prev = spine[Math.max(0, i - 1)];
      const next = spine[Math.min(spine.length - 1, i + 1)];

      // Normal to the flow, in the ground plane.
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tangentLength = Math.hypot(tx, tz) || 1;
      const nx = -tz / tangentLength;
      const nz = tx / tangentLength;

      // How steeply the surface is losing height here, per metre travelled.
      const run = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      const rush = Math.max(0, (prev.y - next.y) / run);
      const flow = i / Math.max(1, spine.length - 1);

      for (let c = 0; c < COLUMNS; c++) {
        const offset = (c / (COLUMNS - 1) - 0.5) * 2 * HALF_WIDTH;
        const x = here.x + nx * offset;
        const z = here.z + nz * offset;
        positions.push(x, here.y, z);
        depths.push(Math.max(0, here.y - terrainHeight(x, z)));
        flows.push(flow);
        rushes.push(rush);
      }
    }

    for (let i = 0; i < spine.length - 1; i++) {
      for (let c = 0; c < COLUMNS - 1; c++) {
        const a = i * COLUMNS + c;
        const b = a + 1;
        const d = (i + 1) * COLUMNS + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
    geometry.setAttribute('aFlow', new Float32BufferAttribute(flows, 1));
    geometry.setAttribute('aRush', new Float32BufferAttribute(rushes, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Surface height used by gameplay — the bobber, splashes, wading. */
  static surfaceHeight(x: number, z: number): number {
    return creekSurfaceHeight(x, z);
  }

  /** A point on the centreline a given fraction down the stream. */
  static pointAlong(fraction: number): { x: number; z: number } {
    const segments = CREEK.points.length - 1;
    const t = Math.max(0, Math.min(0.9999, fraction)) * segments;
    const i = Math.floor(t);
    const f = t - i;
    const a = CREEK.points[i];
    const b = CREEK.points[i + 1];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  /** How far down the stream a world position lies, 0 at the spring, 1 at the mouth. */
  static fractionAt(x: number, z: number): number {
    return projectOntoCreek(x, z).along;
  }

  update(time: number, sunDirection: Vector3, sunColor: Color, skyColor: Color): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uSunDirection.value as Vector3).copy(sunDirection);
    (u.uSunColor.value as Color).copy(sunColor);
    (u.uSkyColor.value as Color).copy(skyColor);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
