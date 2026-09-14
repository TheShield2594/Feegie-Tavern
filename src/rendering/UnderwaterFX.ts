import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Vector3,
} from 'three';
import { SEA_LEVEL } from '@/world/heightfield';
import { clamp01 } from '@/util/math';

/**
 * What the sea looks like from inside it.
 *
 * Three cheap layers that together read as "under water" without a single
 * extra render pass: the shimmering underside of the surface overhead, a ring
 * of light shafts hanging in the water around the diver, and the drifting
 * motes that give the volume a scale. Everything follows the camera, so the
 * whole effect costs three draw calls however far the player swims.
 *
 * The colour grade and the fog ramp belong to {@link LightingRig}; this is only
 * the geometry that has to exist in the world to be lit by it.
 */

const CAUSTIC_GLSL = /* glsl */ `
  // Two counter-rotating cellular fields multiplied together. The product is
  // what gives caustics their characteristic pinched web rather than blobs.
  float caustic(vec2 p, float t) {
    float a = 0.0;
    vec2 q = p;
    for (int i = 0; i < 3; i++) {
      q = mat2(0.8, -0.6, 0.6, 0.8) * q * 1.7;
      a += abs(sin(q.x + t) * sin(q.y - t * 0.8));
    }
    float web = 1.0 - a / 3.0;
    return pow(clamp(web, 0.0, 1.0), 4.0);
  }
`;

export class UnderwaterFX {
  readonly group = new Group();

  private ceiling: Mesh;
  private shafts: Mesh;
  private motes: Points;
  private moteVelocities: Float32Array;
  private moteMaterial: PointsMaterial;

  /** 0 fully dry, 1 fully submerged. */
  private strength = 0;
  private readonly moteExtent = 16;

  constructor(moteCount = 220) {
    this.group.name = 'UnderwaterFX';
    this.group.visible = false;
    // Every layer is a transparent shell around the camera; sorting them
    // against the world costs more than it buys.
    this.group.renderOrder = 2;

    this.ceiling = this.buildCeiling();
    this.shafts = this.buildShafts();

    const positions = new Float32Array(moteCount * 3);
    this.moteVelocities = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * this.moteExtent;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * this.moteExtent * 0.55;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * this.moteExtent;
      this.moteVelocities[i * 3] = (Math.random() * 2 - 1) * 0.12;
      // Motes drift upward on the whole, as anything neutrally buoyant does.
      this.moteVelocities[i * 3 + 1] = 0.06 + Math.random() * 0.16;
      this.moteVelocities[i * 3 + 2] = (Math.random() * 2 - 1) * 0.12;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.moteMaterial = new PointsMaterial({
      color: new Color('#d8f2ef'),
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.motes = new Points(geometry, this.moteMaterial);
    this.motes.frustumCulled = false;
    this.motes.name = 'UnderwaterMotes';

    this.group.add(this.ceiling, this.shafts, this.motes);
  }

  /** The lit underside of the surface, seen looking up. */
  private buildCeiling(): Mesh {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new Color('#9ff0e4') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;
        varying vec3 vWorldPos;
        ${CAUSTIC_GLSL}
        void main() {
          float c = caustic(vWorldPos.xz * 0.45, uTime * 0.6);
          // Fade the sheet out toward its rim so the square never shows itself.
          float radial = 1.0 - smoothstep(14.0, 30.0, length(vWorldPos.xz - cameraPosition.xz));
          float a = c * radial * uStrength;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * (0.35 + c * 0.9), a * 0.85);
        }
      `,
    });
    const mesh = new Mesh(new PlaneGeometry(72, 72, 1, 1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    mesh.name = 'UnderwaterCeiling';
    return mesh;
  }

  /** Shafts of light hanging in the water, brightest just under the surface. */
  private buildShafts(): Mesh {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new Color('#8fe2da') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          // Uneven vertical bands that slide around the cylinder over time.
          float bands =
            sin(vUv.x * 58.0 + uTime * 0.35) * 0.5 +
            sin(vUv.x * 23.0 - uTime * 0.21) * 0.35 +
            sin(vUv.x * 97.0 + uTime * 0.5) * 0.15;
          float shaft = smoothstep(0.45, 1.0, bands * 0.5 + 0.5);
          // Shafts come from the surface, so they fade out with depth.
          float fromSurface = clamp(1.0 - (${SEA_LEVEL.toFixed(1)} - vWorldPos.y) / 9.0, 0.0, 1.0);
          float a = shaft * fromSurface * uStrength * 0.28;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    const mesh = new Mesh(new CylinderGeometry(26, 26, 34, 40, 1, true), material);
    mesh.frustumCulled = false;
    mesh.name = 'UnderwaterShafts';
    return mesh;
  }

  /**
   * @param amount 0 dry, 1 fully submerged. Fades the whole effect in and out
   * rather than snapping, so breaking the surface is a moment rather than a cut.
   */
  setStrength(amount: number): void {
    this.strength = clamp01(amount);
    this.group.visible = this.strength > 0.002;
    (this.ceiling.material as ShaderMaterial).uniforms.uStrength.value = this.strength;
    (this.shafts.material as ShaderMaterial).uniforms.uStrength.value = this.strength;
    this.moteMaterial.opacity = this.strength * 0.55;
  }

  update(dt: number, time: number, cameraPosition: Vector3): void {
    if (!this.group.visible) return;

    (this.ceiling.material as ShaderMaterial).uniforms.uTime.value = time;
    (this.shafts.material as ShaderMaterial).uniforms.uTime.value = time;

    // The ceiling stays welded to the real surface; the rest rides with the
    // camera so the diver is always inside the volume.
    this.ceiling.position.set(cameraPosition.x, SEA_LEVEL - 0.08, cameraPosition.z);
    this.shafts.position.copy(cameraPosition);
    this.motes.position.copy(cameraPosition);

    const positions = this.motes.geometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;
    const extentY = this.moteExtent * 0.55;
    for (let i = 0; i < array.length; i += 3) {
      array[i] += this.moteVelocities[i] * dt;
      array[i + 1] += this.moteVelocities[i + 1] * dt;
      array[i + 2] += this.moteVelocities[i + 2] * dt;
      // Wrap rather than respawn, so the field never thins out or pops.
      if (array[i] > this.moteExtent) array[i] -= this.moteExtent * 2;
      else if (array[i] < -this.moteExtent) array[i] += this.moteExtent * 2;
      if (array[i + 1] > extentY) array[i + 1] -= extentY * 2;
      if (array[i + 2] > this.moteExtent) array[i + 2] -= this.moteExtent * 2;
      else if (array[i + 2] < -this.moteExtent) array[i + 2] += this.moteExtent * 2;
    }
    positions.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.ceiling, this.shafts]) {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
    this.motes.geometry.dispose();
    this.moteMaterial.dispose();
  }
}
