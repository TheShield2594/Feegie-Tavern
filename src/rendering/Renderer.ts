import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GradePass } from './PostFX';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityProfile {
  pixelRatioCap: number;
  shadowMapSize: number;
  shadowsEnabled: boolean;
  bloom: boolean;
  /** Multiplier applied to instanced scatter counts. */
  foliageDensity: number;
  /** Grass tuft draw distance in metres. */
  grassDistance: number;
  waterReflections: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1, shadowMapSize: 1024, shadowsEnabled: true, bloom: false, foliageDensity: 0.4, grassDistance: 34, waterReflections: false },
  medium: { pixelRatioCap: 1.5, shadowMapSize: 2048, shadowsEnabled: true, bloom: true, foliageDensity: 0.7, grassDistance: 46, waterReflections: true },
  high: { pixelRatioCap: 2, shadowMapSize: 3072, shadowsEnabled: true, bloom: true, foliageDensity: 1, grassDistance: 58, waterReflections: true },
};

/**
 * Owns the WebGL context, the post chain, and the automatic quality governor.
 * Systems never touch the renderer directly; they add to `scene` and read
 * `camera`, which keeps swapping the backend a contained change.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly composer: EffectComposer;

  private bloomPass: UnrealBloomPass | null = null;
  private gradePass: ShaderPass;
  private resizeObserver: ResizeObserver | null = null;

  quality: QualityLevel = 'high';
  profile: QualityProfile = QUALITY_PROFILES.high;

  /** Rolling average frame time in ms, used by the governor and the debug HUD. */
  frameMs = 16.7;
  private frameSamples: number[] = [];
  private governorCooldown = 4;
  autoQuality = true;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x9fd6ea, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('cc-canvas');

    this.camera = new PerspectiveCamera(38, 1, 0.4, 900);
    this.camera.position.set(0, 18, 24);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.42, 0.75, 0.86);
    this.composer.addPass(this.bloomPass);

    this.gradePass = new ShaderPass(GradePass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.applyQuality(this.quality);
    this.resize();
    this.observeResize();
  }

  private observeResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap);

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.bloomPass?.setSize(width, height);

    this.camera.aspect = width / Math.max(1, height);
    // The field of view itself belongs to CameraRig, which writes it from its
    // preset spring every frame and would overwrite anything set here. It
    // widens the preset on narrow screens from this same aspect.
    this.camera.updateProjectionMatrix();
  }

  applyQuality(level: QualityLevel): void {
    this.quality = level;
    this.profile = QUALITY_PROFILES[level];
    this.renderer.shadowMap.enabled = this.profile.shadowsEnabled;
    if (this.bloomPass) this.bloomPass.enabled = this.profile.bloom;
    this.resize();
  }

  /** Post-grade parameters, driven by time of day and weather. */
  setGrade(params: {
    tint: [number, number, number];
    saturation: number;
    contrast: number;
    vignette: number;
    lift: number;
    flash: number;
  }): void {
    const u = this.gradePass.uniforms;
    u.uTint.value.set(...params.tint);
    u.uSaturation.value = params.saturation;
    u.uContrast.value = params.contrast;
    u.uVignette.value = params.vignette;
    u.uLift.value = params.lift;
    u.uFlash.value = params.flash;
  }

  setBloom(strength: number, radius = 0.75, threshold = 0.86): void {
    if (!this.bloomPass) return;
    this.bloomPass.strength = strength;
    this.bloomPass.radius = radius;
    this.bloomPass.threshold = threshold;
  }

  render(dt: number): void {
    this.trackFrame(dt);
    // The composer renders several passes per frame; accumulate their stats
    // rather than letting each pass reset the counters.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  private trackFrame(dt: number): void {
    const ms = Math.max(0.1, dt * 1000);
    this.frameSamples.push(ms);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    this.frameMs = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;

    if (!this.autoQuality) return;
    this.governorCooldown -= dt;
    if (this.governorCooldown > 0 || this.frameSamples.length < 60) return;

    // Only step quality when the average is clearly off target, so a single
    // hitch (a panel opening, a shader compiling) never drops the whole scene.
    if (this.frameMs > 26 && this.quality !== 'low') {
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
      this.governorCooldown = 8;
      this.frameSamples.length = 0;
    } else if (this.frameMs < 13.5 && this.quality !== 'high') {
      this.applyQuality(this.quality === 'low' ? 'medium' : 'high');
      this.governorCooldown = 12;
      this.frameSamples.length = 0;
    }
  }

  get info(): { calls: number; triangles: number; programs: number } {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
