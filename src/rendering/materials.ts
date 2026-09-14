import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  ShaderChunk,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { PALETTE } from './palette';

/**
 * Shared uniforms driven once per frame by the renderer. Wind and season tint
 * live here so hundreds of instanced meshes stay in sync without per-object work.
 */
export const sharedUniforms: Record<string, IUniform> = {
  uTime: { value: 0 },
  uWind: { value: 0.35 },
  uWindDir: { value: [0.72, 0.69] },
  uSeasonTint: { value: new Color('#8ecb6a') },
  uSeasonBlend: { value: 0 },
  uWetness: { value: 0 },
};

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uWetness;

// Two-frequency sway so foliage does not pulse in lockstep. Stiffness is 0 at
// the base of a plant and 1 at the tip, supplied via the geometry uv.y or a
// dedicated attribute.
vec3 applyWind(vec3 pos, vec3 anchor, float stiffness, float phase) {
  float t = uTime * 1.35 + phase;
  float gust = sin(t * 0.31 + anchor.x * 0.08 + anchor.z * 0.06) * 0.5 + 0.5;
  float amp = uWind * stiffness * (0.35 + gust * 0.9);
  float swayA = sin(t * 1.7 + anchor.x * 0.35);
  float swayB = sin(t * 2.9 + anchor.z * 0.41) * 0.45;
  vec2 offset = uWindDir * (swayA + swayB) * amp;
  pos.x += offset.x;
  pos.z += offset.y;
  // Keep the tip roughly on its arc rather than stretching the mesh.
  pos.y -= (abs(offset.x) + abs(offset.y)) * 0.18 * stiffness;
  return pos;
}
`;

export interface StylizedMaterialOptions {
  color?: string | Color;
  roughness?: number;
  metalness?: number;
  /** Enables the wind vertex displacement. */
  wind?: 'none' | 'foliage' | 'grass' | 'canopy';
  /** Multiplies the wind strength for this material. */
  windScale?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  vertexColors?: boolean;
  side?: typeof DoubleSide | undefined;
  emissive?: string;
  emissiveIntensity?: number;
  /** Darkens and glosses the surface when it rains. */
  wetResponse?: number;
}

/**
 * Stylised surface material. Built on MeshStandardMaterial so it keeps real
 * shadows and image-based lighting, then patched for wind, wetness and a
 * softened terminator that reads as painted rather than photoreal.
 */
export function createStylizedMaterial(options: StylizedMaterialOptions = {}): MeshStandardMaterial {
  const {
    color = PALETTE.grass.base,
    roughness = 0.92,
    metalness = 0,
    wind = 'none',
    windScale = 1,
    flatShading = false,
    transparent = false,
    opacity = 1,
    alphaTest = 0,
    vertexColors = false,
    side,
    emissive,
    emissiveIntensity = 1,
    wetResponse = 0.35,
  } = options;

  const material = new MeshStandardMaterial({
    color: new Color(color),
    roughness,
    metalness,
    flatShading,
    transparent,
    opacity,
    alphaTest,
    vertexColors,
    emissive: emissive ? new Color(emissive) : new Color(0x000000),
    emissiveIntensity,
    ...(side ? { side } : {}),
  });

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.uniforms.uWindDir = sharedUniforms.uWindDir;
    shader.uniforms.uWetness = sharedUniforms.uWetness;
    shader.uniforms.uWindScale = { value: windScale };
    shader.uniforms.uWetResponse = { value: wetResponse };

    shader.vertexShader = `uniform float uWindScale;\n${WIND_PARS}\n${shader.vertexShader}`;

    if (wind !== 'none') {
      // `stiffness` differs by plant type: grass bends from the ground up,
      // canopies pivot around the trunk, generic foliage uses local height.
      const stiffnessExpr =
        wind === 'grass'
          ? 'clamp(uv.y, 0.0, 1.0)'
          : wind === 'canopy'
            ? 'clamp((transformed.y - 0.4) * 0.34, 0.0, 1.0)'
            : 'clamp(transformed.y * 0.42, 0.0, 1.0)';

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 windAnchor = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 windAnchor = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
          #endif
          float stiffness = ${stiffnessExpr} * uWindScale;
          float phase = windAnchor.x * 0.21 + windAnchor.z * 0.17;
          transformed = applyWind(transformed, windAnchor, stiffness, phase);
        }
        `,
      );
    }

    shader.fragmentShader = `uniform float uWetness;\nuniform float uWetResponse;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
      #include <roughnessmap_fragment>
      // Rain darkens and polishes surfaces; the strength is per-material so
      // thatch and stone react differently to the same downpour.
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.32 + 0.04, uWetness * uWetResponse);
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      #include <color_fragment>
      diffuseColor.rgb *= mix(1.0, 0.82, uWetness * uWetResponse);
      `,
    );
  };

  // Distinct keys keep three's program cache from merging incompatible patches.
  material.customProgramCacheKey = () => `cozy:${wind}:${windScale}:${wetResponse}`;

  return material;
}

/** Registers the wind helpers so custom ShaderMaterials can reuse them. */
export function registerShaderChunks(): void {
  (ShaderChunk as Record<string, string>).cozy_wind_pars = WIND_PARS;
}

export function updateSharedUniforms(time: number, wind: number, wetness: number, seasonTint: Color): void {
  sharedUniforms.uTime.value = time;
  sharedUniforms.uWind.value = wind;
  sharedUniforms.uWetness.value = wetness;
  (sharedUniforms.uSeasonTint.value as Color).copy(seasonTint);
}
