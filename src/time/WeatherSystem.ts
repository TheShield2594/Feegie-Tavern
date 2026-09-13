import type { EventBus } from '@/core/EventBus';
import { Rng } from '@/util/rng';
import { damp } from '@/util/math';
import type { Season } from './TimeSystem';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export interface WeatherProfile {
  kind: WeatherKind;
  label: string;
  /** 0 = cloudless, 1 = fully overcast. Drives sun intensity and sky colour. */
  cloudCover: number;
  /** Rain/snow particle density, 0–1. */
  precipitation: number;
  /** Exponential fog density multiplier. */
  fog: number;
  /** Wind strength driving foliage and water. */
  wind: number;
  /** Extra ambient darkening. */
  gloom: number;
  /** Whether lightning can strike. */
  lightning: boolean;
}

export const WEATHER_PROFILES: Record<WeatherKind, WeatherProfile> = {
  clear: { kind: 'clear', label: 'Clear', cloudCover: 0.12, precipitation: 0, fog: 0.5, wind: 0.35, gloom: 0, lightning: false },
  cloudy: { kind: 'cloudy', label: 'Cloudy', cloudCover: 0.65, precipitation: 0, fog: 0.8, wind: 0.55, gloom: 0.18, lightning: false },
  rain: { kind: 'rain', label: 'Rain', cloudCover: 0.9, precipitation: 0.65, fog: 1.35, wind: 0.7, gloom: 0.34, lightning: false },
  storm: { kind: 'storm', label: 'Stormy', cloudCover: 1, precipitation: 1, fog: 1.7, wind: 1, gloom: 0.5, lightning: true },
  fog: { kind: 'fog', label: 'Sea Mist', cloudCover: 0.5, precipitation: 0, fog: 3.4, wind: 0.15, gloom: 0.2, lightning: false },
};

/** Per-season odds. Winter and autumn get more weather; summer stays bright. */
const SEASON_WEIGHTS: Record<Season, Record<WeatherKind, number>> = {
  Spring: { clear: 44, cloudy: 24, rain: 20, storm: 4, fog: 8 },
  Summer: { clear: 60, cloudy: 20, rain: 12, storm: 5, fog: 3 },
  Autumn: { clear: 34, cloudy: 28, rain: 22, storm: 6, fog: 10 },
  Winter: { clear: 30, cloudy: 30, rain: 18, storm: 8, fog: 14 },
};

/**
 * Chooses and blends weather. The blend is deliberately slow: `current` is what
 * renderers read, and it eases toward the target profile over ~20 seconds so
 * the island visibly changes rather than snapping.
 */
export class WeatherSystem {
  kind: WeatherKind = 'clear';
  private targetKind: WeatherKind = 'clear';
  /** In-game minutes left on the current pattern. */
  remaining = 360;
  private rng: Rng;

  /** Smoothly interpolated values renderers should read. */
  readonly current: WeatherProfile = { ...WEATHER_PROFILES.clear };

  /** 0–1 flash intensity, spikes during storms. */
  lightningFlash = 0;
  private nextStrike = 0;

  constructor(
    private bus: EventBus,
    seed = 20260913,
  ) {
    this.rng = new Rng(seed);
  }

  set(kind: WeatherKind, durationMinutes = 300, immediate = false): void {
    const previous = this.kind;
    this.kind = kind;
    this.targetKind = kind;
    this.remaining = durationMinutes;
    if (immediate) Object.assign(this.current, WEATHER_PROFILES[kind]);
    if (previous !== kind) this.bus.emit('weather:change', { kind, previous });
  }

  /** Advances the forecast. `elapsedMinutes` comes from the TimeSystem. */
  tickMinutes(elapsedMinutes: number, season: Season): void {
    this.remaining -= elapsedMinutes;
    if (this.remaining > 0) return;
    this.set(this.roll(season), this.rng.range(180, 540));
  }

  private roll(season: Season): WeatherKind {
    const weights = SEASON_WEIGHTS[season];
    let total = 0;
    for (const w of Object.values(weights)) total += w;
    let pick = this.rng.next() * total;
    for (const [kind, weight] of Object.entries(weights) as [WeatherKind, number][]) {
      pick -= weight;
      if (pick <= 0) return kind;
    }
    return 'clear';
  }

  /** Per-frame blending and lightning. */
  update(dt: number): void {
    const target = WEATHER_PROFILES[this.targetKind];
    const halfLife = 4;
    this.current.cloudCover = damp(this.current.cloudCover, target.cloudCover, halfLife, dt);
    this.current.precipitation = damp(this.current.precipitation, target.precipitation, halfLife, dt);
    this.current.fog = damp(this.current.fog, target.fog, halfLife, dt);
    this.current.wind = damp(this.current.wind, target.wind, halfLife * 0.5, dt);
    this.current.gloom = damp(this.current.gloom, target.gloom, halfLife, dt);
    this.current.kind = target.kind;
    this.current.label = target.label;
    this.current.lightning = target.lightning;

    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5.5);
    if (target.lightning && this.current.precipitation > 0.5) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = this.rng.range(5, 18);
        this.lightningFlash = this.rng.range(0.7, 1);
      }
    }
  }

  get label(): string {
    return WEATHER_PROFILES[this.kind].label;
  }

  /** Whether the ground should render wet. */
  get wetness(): number {
    return Math.min(1, this.current.precipitation * 1.4);
  }
}
