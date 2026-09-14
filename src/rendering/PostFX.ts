import { Vector3 } from 'three';

/**
 * Final colour grade. Handles the time-of-day tint, a gentle S-curve, the
 * vignette that keeps attention on the player, and the storm lightning flash.
 * Kept as one pass so the whole look costs a single full-screen draw.
 */
export const GradePass = {
  name: 'CozyGradePass',
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new Vector3(1, 1, 1) },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.04 },
    uVignette: { value: 0.32 },
    uLift: { value: 0.0 },
    uFlash: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uLift;
    uniform float uFlash;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      color *= uTint;

      // Lift the shadows slightly so night reads as moonlit rather than black.
      color = color + uLift * (1.0 - color);

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;

      // Soft radial falloff, stronger on the vertical axis to frame the scene.
      vec2 centered = (vUv - 0.5) * vec2(1.0, 1.12);
      float vig = smoothstep(0.86, 0.28, length(centered));
      color *= mix(1.0, vig, uVignette);

      color += uFlash * vec3(0.72, 0.78, 0.95);

      gl_FragColor = vec4(clamp(color, 0.0, 1.6), texel.a);
    }
  `,
};
