import { AmbientLight, Color, DirectionalLight, FogExp2, HemisphereLight, Scene, Vector3 } from 'three';
import { clamp01, lerp, smoothstep } from '@/util/math';
import { PALETTE } from './palette';
import type { Sky } from './Sky';
import type { TimeSnapshot } from '@/time/TimeSystem';
import type { WeatherProfile } from '@/time/WeatherSystem';
import type { QualityProfile } from './Renderer';

interface GradeStops {
  at: number;
  skyTop: string;
  skyBottom: string;
  horizon: string;
  sun: string;
  sunIntensity: number;
  ambient: string;
  ambientIntensity: number;
  fog: string;
  fogDensity: number;
  tint: [number, number, number];
  lift: number;
  exposure: number;
}

/**
 * Keyframed day cycle. Each stop is a complete lighting look; the rig
 * interpolates between the two stops bracketing the current time, then applies
 * weather on top. Adding a new time of day means adding a stop, not editing code.
 */
const DAY_STOPS: GradeStops[] = [
  {
    at: 0,
    skyTop: PALETTE.sky.nightTop, skyBottom: PALETTE.sky.nightBottom, horizon: '#2b3a63',
    sun: PALETTE.light.moon, sunIntensity: 0.4,
    ambient: PALETTE.light.ambientNight, ambientIntensity: 1.1,
    fog: '#1a2440', fogDensity: 0.0048,
    tint: [0.86, 0.92, 1.1], lift: 0.045, exposure: 1.0,
  },
  {
    at: 5.1,
    skyTop: '#2f4a80', skyBottom: '#8f7fa8', horizon: '#d78f7a',
    sun: '#ff9d7a', sunIntensity: 0.55,
    ambient: '#6b7aa0', ambientIntensity: 0.82,
    fog: '#5d6b90', fogDensity: 0.0095,
    tint: [1.03, 0.94, 0.98], lift: 0.03, exposure: 0.97,
  },
  {
    at: 6.8,
    skyTop: PALETTE.sky.dawnTop, skyBottom: PALETTE.sky.dawnBottom, horizon: '#ffcb96',
    sun: PALETTE.light.sunDawn, sunIntensity: 1.35,
    ambient: '#a9c4dd', ambientIntensity: 0.9,
    fog: '#c9c4bb', fogDensity: 0.0072,
    tint: [1.08, 0.99, 0.93], lift: 0.012, exposure: 1.03,
  },
  {
    at: 9.5,
    skyTop: PALETTE.sky.dayTop, skyBottom: PALETTE.sky.dayBottom, horizon: '#e2f2fa',
    sun: PALETTE.light.sunDay, sunIntensity: 2.05,
    ambient: PALETTE.light.ambientDay, ambientIntensity: 1.0,
    fog: '#cfe6f2', fogDensity: 0.0036,
    tint: [1.0, 1.0, 1.0], lift: 0.0, exposure: 1.06,
  },
  {
    at: 13,
    skyTop: '#3f96d4', skyBottom: '#d6eefa', horizon: '#eaf6fb',
    sun: '#fffaf0', sunIntensity: 2.25,
    ambient: '#c6e0ee', ambientIntensity: 1.02,
    fog: '#d6ebf5', fogDensity: 0.0032,
    tint: [1.0, 1.0, 1.0], lift: 0.0, exposure: 1.08,
  },
  {
    at: 16.5,
    skyTop: '#4d92c6', skyBottom: '#f0dfc0', horizon: '#f7d3a0',
    sun: '#ffe2b0', sunIntensity: 1.9,
    ambient: '#c2d2dd', ambientIntensity: 0.94,
    fog: '#dcd7c6', fogDensity: 0.0042,
    tint: [1.04, 1.0, 0.95], lift: 0.0, exposure: 1.06,
  },
  {
    at: 18.6,
    skyTop: PALETTE.sky.sunsetTop, skyBottom: PALETTE.sky.sunsetBottom, horizon: '#ff9a5c',
    sun: PALETTE.light.sunSunset, sunIntensity: 1.35,
    ambient: '#9a94b8', ambientIntensity: 0.92,
    fog: '#c98f74', fogDensity: 0.0068,
    tint: [1.11, 0.96, 0.9], lift: 0.012, exposure: 1.02,
  },
  {
    at: 20.2,
    skyTop: '#26325e', skyBottom: '#7a5a86', horizon: '#c76d72',
    sun: '#c07a92', sunIntensity: 0.6,
    ambient: '#5f6c9c', ambientIntensity: 0.9,
    fog: '#54527a', fogDensity: 0.0086,
    tint: [0.95, 0.9, 1.04], lift: 0.03, exposure: 0.96,
  },
  {
    at: 22,
    skyTop: PALETTE.sky.nightTop, skyBottom: PALETTE.sky.nightBottom, horizon: '#2b3a63',
    sun: PALETTE.light.moon, sunIntensity: 0.4,
    ambient: PALETTE.light.ambientNight, ambientIntensity: 1.1,
    fog: '#1a2440', fogDensity: 0.0048,
    tint: [0.86, 0.92, 1.1], lift: 0.045, exposure: 1.0,
  },
  { // Wraps back to midnight.
    at: 24,
    skyTop: PALETTE.sky.nightTop, skyBottom: PALETTE.sky.nightBottom, horizon: '#2b3a63',
    sun: PALETTE.light.moon, sunIntensity: 0.4,
    ambient: PALETTE.light.ambientNight, ambientIntensity: 1.1,
    fog: '#1a2440', fogDensity: 0.0048,
    tint: [0.86, 0.92, 1.1], lift: 0.045, exposure: 1.0,
  },
];

export interface LightingOutput {
  tint: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  lift: number;
  flash: number;
  exposure: number;
  bloom: number;
  /** 0–1, how lit the world is. Drives window lights, lamps and fireflies. */
  darkness: number;
}

/** The look under the surface: a blue-green ramp that swallows everything. */
const UNDERWATER = {
  fog: '#14515e',
  fogDensity: 0.085,
  tint: [0.62, 0.94, 1.02] as [number, number, number],
  /** Colour of the flat fill that keeps the diver from reading as a silhouette. */
  fill: '#6fb8c4',
};

/** Extra flat fill once the sun is down, so night shadows stay readable. */
function darknessFill(sunHeight: number): number {
  return clamp01(-sunHeight * 3);
}

const scratchA = new Color();
const scratchB = new Color();

/**
 * Drives sun, moon, ambient, fog and the colour grade from the clock and the
 * weather. Shadow camera follows the player so a modest map covers the
 * playable area at high resolution instead of blurring across the whole island.
 */
export class LightingRig {
  readonly sun: DirectionalLight;
  readonly moon: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly fog: FogExp2;

  private sunTarget = new Vector3();
  private shadowRadius = 42;

  constructor(
    private scene: Scene,
    private sky: Sky,
  ) {
    this.sun = new DirectionalLight(0xfff4dc, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    // A blurred penumbra reads as a soft contact shadow rather than a hard
    // cut, which suits the diorama look. Needs PCFShadowMap on the renderer.
    this.sun.shadow.radius = 5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new DirectionalLight(0x9fb6e8, 0);
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.hemi = new HemisphereLight(0xbcd8e8, 0x7f9a5f, 0.8);
    scene.add(this.hemi);

    this.ambient = new AmbientLight(0xffffff, 0.28);
    scene.add(this.ambient);

    this.fog = new FogExp2(0xcfe6f2, 0.0042);
    scene.add(this.sky.mesh);
    scene.fog = this.fog;
  }

  setShadowQuality(profile: QualityProfile): void {
    this.sun.castShadow = profile.shadowsEnabled;
    if (this.sun.shadow.mapSize.x !== profile.shadowMapSize) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.shadowRadius = profile.shadowMapSize >= 3072 ? 46 : profile.shadowMapSize >= 2048 ? 38 : 30;
  }

  private stopsFor(hour: number): { a: GradeStops; b: GradeStops; t: number } {
    let a = DAY_STOPS[0];
    let b = DAY_STOPS[DAY_STOPS.length - 1];
    for (let i = 0; i < DAY_STOPS.length - 1; i++) {
      if (hour >= DAY_STOPS[i].at && hour <= DAY_STOPS[i + 1].at) {
        a = DAY_STOPS[i];
        b = DAY_STOPS[i + 1];
        break;
      }
    }
    const span = Math.max(1e-4, b.at - a.at);
    return { a, b, t: smoothstep(0, 1, clamp01((hour - a.at) / span)) };
  }

  /**
   * @param focus Where the shadow frustum should centre — normally the player.
   * @param underwater 0 dry, 1 fully submerged. Ramps the fog and the grade
   * into the underwater look rather than switching to it, so surfacing reads
   * as coming up rather than as a cut.
   */
  update(
    time: TimeSnapshot,
    weather: WeatherProfile,
    lightningFlash: number,
    focus: Vector3,
    indoors: boolean,
    underwater = 0,
  ): LightingOutput {
    const hour = time.minutes / 60;
    const { a, b, t } = this.stopsFor(hour);

    const overcast = clamp01(weather.cloudCover);
    const gloom = weather.gloom;

    // --- Sun / moon direction ---------------------------------------------
    const sunAngle = ((hour - 6) / 12) * Math.PI;
    const sunHeight = Math.sin(sunAngle);
    // The sun is tilted off the zenith so even noon has a little rake to it:
    // dead-overhead light flattens every face and shortens every shadow.
    const sunDir = new Vector3(Math.cos(sunAngle) * 0.82, Math.max(-0.4, sunHeight), 0.6).normalize();
    const moonDir = sunDir.clone().negate();

    this.sunTarget.copy(focus);
    this.sun.target.position.copy(this.sunTarget);
    this.sun.position.copy(this.sunTarget).addScaledVector(sunDir, 90);
    this.moon.target.position.copy(this.sunTarget);
    this.moon.position.copy(this.sunTarget).addScaledVector(moonDir, 90);

    const cam = this.sun.shadow.camera;
    const r = this.shadowRadius;
    if (cam.left !== -r) {
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.updateProjectionMatrix();
    }

    // --- Intensities -------------------------------------------------------
    const dayness = clamp01(sunHeight * 1.4);
    const cloudCut = lerp(1, 0.52, overcast);
    const indoorCut = indoors ? 0.45 : 1;

    scratchA.set(a.sun);
    scratchB.set(b.sun);
    this.sun.color.copy(scratchA).lerp(scratchB, t);
    this.sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t) * cloudCut * indoorCut;

    // The moon only contributes once the sun is genuinely below the horizon.
    const moonStrength = clamp01(-sunHeight * 2.2);
    this.moon.intensity = moonStrength * 1.05 * lerp(1, 0.45, overcast) * indoorCut;
    this.moon.castShadow = false;

    scratchA.set(a.ambient);
    scratchB.set(b.ambient);
    const ambientColor = scratchA.clone().lerp(scratchB, t);
    this.hemi.color.copy(ambientColor);
    this.hemi.groundColor.set(PALETTE.light.groundBounce).lerp(ambientColor, 0.55 + overcast * 0.25);
    // Overcast skies flatten the key light but raise the fill.
    this.hemi.intensity = lerp(a.ambientIntensity, b.ambientIntensity, t) * 1.15 * lerp(1, 1.3, overcast) * (indoors ? 0.4 : 1);
    this.ambient.intensity = 0.16 + overcast * 0.12 + (indoors ? 0.06 : 0) + darknessFill(sunHeight) * 0.1;

    // Under water the key light is most of the way gone and the grade takes
    // another fifth off the exposure, which leaves the diver — the one thing
    // that has to stay readable down there — as a black cut-out against the
    // fog. Scattered light is what actually lights a body underwater, so the
    // fill comes up rather than the sun.
    if (underwater > 0) {
      this.hemi.color.lerp(scratchA.set(UNDERWATER.fill), underwater * 0.8);
      this.hemi.groundColor.lerp(scratchA.set(UNDERWATER.fog), underwater * 0.7);
      this.hemi.intensity = lerp(this.hemi.intensity, 2.3, underwater);
      this.ambient.intensity = lerp(this.ambient.intensity, 0.5, underwater);
    }

    // --- Fog ---------------------------------------------------------------
    scratchA.set(a.fog);
    scratchB.set(b.fog);
    this.fog.color.copy(scratchA).lerp(scratchB, t);
    if (overcast > 0.2) this.fog.color.lerp(scratchA.set('#a8b4bd'), overcast * 0.35);
    this.fog.density = lerp(a.fogDensity, b.fogDensity, t) * weather.fog * (indoors ? 0.15 : 1);
    if (underwater > 0) {
      // Water is its own weather: the sky's colour and the day's haze stop
      // mattering the moment the surface closes over the player's head.
      this.fog.color.lerp(scratchB.set(UNDERWATER.fog), underwater);
      this.fog.density = lerp(this.fog.density, UNDERWATER.fogDensity, underwater);
    }

    // --- Sky ---------------------------------------------------------------
    const u = this.sky.uniforms;
    scratchA.set(a.skyTop); scratchB.set(b.skyTop);
    (u.uTopColor.value as Color).copy(scratchA).lerp(scratchB, t);
    scratchA.set(a.skyBottom); scratchB.set(b.skyBottom);
    (u.uBottomColor.value as Color).copy(scratchA).lerp(scratchB, t);
    scratchA.set(a.horizon); scratchB.set(b.horizon);
    (u.uHorizonGlow.value as Color).copy(scratchA).lerp(scratchB, t);

    if (overcast > 0.25) {
      const grey = clamp01((overcast - 0.25) / 0.75) * 0.8;
      (u.uTopColor.value as Color).lerp(scratchA.set(PALETTE.sky.overcastTop), grey);
      (u.uBottomColor.value as Color).lerp(scratchA.set(PALETTE.sky.overcastBottom), grey);
    }

    (u.uSunDirection.value as Vector3).copy(sunDir);
    (u.uMoonDirection.value as Vector3).copy(moonDir);
    (u.uSunColor.value as Color).copy(this.sun.color);
    u.uCloudCover.value = overcast;
    u.uStarStrength.value = moonStrength * lerp(1, 0.15, overcast);
    // The horizon band only glows near sunrise and sunset.
    u.uGlowStrength.value = clamp01(1 - Math.abs(sunHeight) * 2.6) * lerp(0.85, 0.25, overcast);
    u.uWind.value = weather.wind;

    // --- Grade -------------------------------------------------------------
    const tint: [number, number, number] = [
      lerp(a.tint[0], b.tint[0], t),
      lerp(a.tint[1], b.tint[1], t),
      lerp(a.tint[2], b.tint[2], t),
    ];
    // Rain desaturates and cools; mist lifts the blacks.
    const desat = 1 - overcast * 0.22 - (weather.kind === 'fog' ? 0.08 : 0);
    // Darkness drives lamps, window glow and fireflies, so it tracks the sun
    // rather than the weather: an overcast afternoon should not light the
    // street lamps.
    const darkness = clamp01(1 - dayness) * (indoors ? 0.55 : 1);

    return {
      tint: [
        lerp(tint[0] * (1 - gloom * 0.16), UNDERWATER.tint[0], underwater),
        lerp(tint[1] * (1 - gloom * 0.13), UNDERWATER.tint[1], underwater),
        lerp(tint[2] * (1 - gloom * 0.06), UNDERWATER.tint[2], underwater),
      ],
      saturation: lerp(1.04 * desat, 0.88, underwater),
      contrast: lerp(1.035 - overcast * 0.03, 0.96, underwater),
      vignette: 0.26 + darkness * 0.16 + overcast * 0.05 + underwater * 0.24,
      lift: lerp(a.lift, b.lift, t) + (weather.kind === 'fog' ? 0.03 : 0),
      flash: lightningFlash * 0.65,
      exposure: lerp(a.exposure, b.exposure, t) * lerp(1, 0.94, overcast) * lerp(1, 0.82, underwater),
      bloom: 0.2 + darkness * 0.18 + (weather.kind === 'rain' || weather.kind === 'storm' ? 0.12 : 0),
      darkness,
    };
  }

  dispose(): void {
    this.scene.remove(this.sun, this.sun.target, this.moon, this.moon.target, this.hemi, this.ambient);
  }
}
