import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

/**
 * Sky dome. One shader draws the gradient, sun disc and glow, moon, stars and a
 * drifting cloud band, which keeps the whole sky to a single draw call and lets
 * time of day and weather drive it through a handful of uniforms.
 */
export class Sky {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor(radius = 520) {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTopColor: { value: new Color('#4a9fd8') },
        uBottomColor: { value: new Color('#c8e8f5') },
        uSunDirection: { value: new Vector3(0.3, 0.6, 0.4) },
        uSunColor: { value: new Color('#fff4dc') },
        uMoonDirection: { value: new Vector3(-0.3, -0.6, -0.4) },
        uCloudCover: { value: 0.2 },
        uCloudColor: { value: new Color('#ffffff') },
        uCloudShadow: { value: new Color('#9aa8b8') },
        uTime: { value: 0 },
        uStarStrength: { value: 0 },
        uHorizonGlow: { value: new Color('#f6b98a') },
        uGlowStrength: { value: 0.3 },
        uWind: { value: 0.4 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDirection;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(world.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldDirection;

        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uMoonDirection;
        uniform float uCloudCover;
        uniform vec3 uCloudColor;
        uniform vec3 uCloudShadow;
        uniform float uTime;
        uniform float uStarStrength;
        uniform vec3 uHorizonGlow;
        uniform float uGlowStrength;
        uniform float uWind;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        float fbm(vec2 p) {
          float sum = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 5; i++) {
            sum += noise(p) * amp;
            p *= 2.07;
            amp *= 0.5;
          }
          return sum;
        }

        void main() {
          vec3 dir = normalize(vWorldDirection);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

          // Bias the gradient toward the horizon so the sky does not read as a
          // flat lerp from zenith to ground.
          float gradient = pow(clamp(dir.y, 0.0, 1.0), 0.55);
          vec3 color = mix(uBottomColor, uTopColor, gradient);

          // Warm band hugging the horizon, strongest at sunrise and sunset.
          float horizon = pow(1.0 - clamp(abs(dir.y) * 2.6, 0.0, 1.0), 2.2);
          color = mix(color, uHorizonGlow, horizon * uGlowStrength);

          // Stars, faded in at night and hidden under cloud.
          if (uStarStrength > 0.001 && dir.y > -0.02) {
            vec2 starUv = dir.xz / max(0.08, dir.y + 0.35) * 34.0;
            float star = hash(floor(starUv));
            float twinkle = 0.65 + 0.35 * sin(uTime * 2.1 + star * 40.0);
            float spark = smoothstep(0.9955, 0.9995, star) * twinkle;
            color += spark * uStarStrength * (1.0 - uCloudCover * 0.85) * vec3(0.9, 0.94, 1.0);
          }

          // Sun disc plus a wide bloom halo.
          float sunAmount = max(dot(dir, normalize(uSunDirection)), 0.0);
          float disc = smoothstep(0.9985, 0.99955, sunAmount);
          float halo = pow(sunAmount, 220.0) * 0.55 + pow(sunAmount, 14.0) * 0.14;
          color += uSunColor * (disc * 2.4 + halo) * (1.0 - uCloudCover * 0.7);

          // Moon: a small disc with a soft edge, visible whenever it is up.
          float moonAmount = max(dot(dir, normalize(uMoonDirection)), 0.0);
          float moonDisc = smoothstep(0.9990, 0.99965, moonAmount);
          float moonGlow = pow(moonAmount, 340.0) * 0.4;
          color += vec3(0.86, 0.9, 1.0) * (moonDisc * 1.5 + moonGlow) * uStarStrength * (1.0 - uCloudCover * 0.8);

          // Cloud band. Projected onto a plane above the camera so the clouds
          // stretch toward the horizon the way real ones do.
          if (dir.y > 0.005) {
            vec2 cloudUv = dir.xz / dir.y * 0.55;
            cloudUv += vec2(uTime * 0.0075 * (0.4 + uWind), uTime * 0.0045 * (0.4 + uWind));
            float density = fbm(cloudUv * 1.15);
            float detail = fbm(cloudUv * 3.4 + 11.7);
            density = density * 0.72 + detail * 0.28;

            float coverage = smoothstep(0.72 - uCloudCover * 0.62, 0.95 - uCloudCover * 0.42, density);
            // Fade clouds out near the horizon so the band does not hard-edge.
            coverage *= smoothstep(0.0, 0.19, dir.y);

            float lit = smoothstep(0.35, 0.85, density) * max(0.0, dot(normalize(uSunDirection), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5);
            vec3 cloud = mix(uCloudShadow, uCloudColor, lit);
            cloud += uSunColor * pow(sunAmount, 8.0) * 0.35;
            color = mix(color, cloud, coverage * clamp(0.35 + uCloudCover, 0.0, 1.0));
          }

          color = mix(color, color * 1.02, h);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.mesh = new Mesh(new SphereGeometry(radius, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'Sky';
  }

  get uniforms() {
    return this.material.uniforms;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  /** Keeps the dome centred on the camera so it never clips. */
  follow(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
