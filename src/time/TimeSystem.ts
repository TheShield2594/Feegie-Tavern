import type { EventBus } from '@/core/EventBus';
import { clamp01, inverseLerp } from '@/util/math';

export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter';
export type DayPhase = 'dawn' | 'morning' | 'day' | 'afternoon' | 'sunset' | 'dusk' | 'night';

export const SEASONS: Season[] = ['Spring', 'Summer', 'Autumn', 'Winter'];
/** Days per season, matching the prototype's week-long seasons. */
export const SEASON_LENGTH = 7;
/** Real seconds per in-game minute. One in-game day is ~24 real minutes. */
export const DEFAULT_MINUTE_DURATION = 1;

export interface TimeSnapshot {
  day: number;
  minutes: number;
  hour: number;
  /** 0–1 through the day. */
  dayFraction: number;
  season: Season;
  phase: DayPhase;
  /** 0 at midnight, 1 at noon — the sun's height driver. */
  sunHeight: number;
  isNight: boolean;
}

/**
 * Owns the in-game clock. Everything time-dependent (lighting, NPC schedules,
 * crop growth, spawn tables) reads this rather than keeping its own counter.
 */
export class TimeSystem {
  day = 1;
  minutes = 8 * 60;
  /** Real seconds per in-game minute. Raised while sleeping/skipping. */
  minuteDuration = DEFAULT_MINUTE_DURATION;
  paused = false;

  private accumulator = 0;
  private lastHour = -1;
  private lastPhase: DayPhase | null = null;

  constructor(private bus: EventBus) {}

  get hour(): number {
    return Math.floor(this.minutes / 60);
  }

  get minuteOfHour(): number {
    return Math.floor(this.minutes % 60);
  }

  get season(): Season {
    return SEASONS[Math.floor((this.day - 1) / SEASON_LENGTH) % SEASONS.length];
  }

  get dayFraction(): number {
    return this.minutes / 1440;
  }

  get isNight(): boolean {
    return this.minutes < 5 * 60 + 20 || this.minutes >= 19 * 60 + 40;
  }

  get phase(): DayPhase {
    const h = this.minutes / 60;
    if (h < 5.3) return 'night';
    if (h < 7) return 'dawn';
    if (h < 10) return 'morning';
    if (h < 15) return 'day';
    if (h < 17.5) return 'afternoon';
    if (h < 19.3) return 'sunset';
    if (h < 20.5) return 'dusk';
    return 'night';
  }

  /**
   * Height of the sun above the horizon, 0 at night and 1 at solar noon.
   * Used directly by the lighting rig, so it is smooth rather than stepped.
   */
  get sunHeight(): number {
    const h = this.minutes / 60;
    // Sunrise 5:20, sunset 19:40 — a sine arc between them.
    const rise = 5.33;
    const set = 19.66;
    if (h <= rise || h >= set) return 0;
    return Math.sin(Math.PI * inverseLerp(rise, set, h));
  }

  /** Signed east→west sun azimuth in radians, for shadow direction. */
  get sunAzimuth(): number {
    return (this.dayFraction - 0.25) * Math.PI * 2;
  }

  snapshot(): TimeSnapshot {
    return {
      day: this.day,
      minutes: this.minutes,
      hour: this.hour,
      dayFraction: this.dayFraction,
      season: this.season,
      phase: this.phase,
      sunHeight: this.sunHeight,
      isNight: this.isNight,
    };
  }

  update(dt: number): void {
    if (this.paused) return;
    this.accumulator += dt;
    const step = Math.max(0.001, this.minuteDuration);
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.advanceMinute();
    }
  }

  private advanceMinute(): void {
    this.minutes += 1;
    if (this.minutes >= 1440) {
      this.minutes -= 1440;
      this.day += 1;
      this.bus.emit('time:day', { day: this.day, season: this.season });
    }
    const hour = this.hour;
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      this.bus.emit('time:hour', { hour, day: this.day });
    }
    // Phases turn over at fractional times (05:18, 17:30, 19:18, 20:30), so
    // tying the event to the hour delivered some of them up to 42 minutes late.
    const phase = this.phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      this.bus.emit('time:phase', { phase });
    }
  }

  /** Fast-forwards to the given hour, firing day/hour events along the way. */
  skipTo(hour: number): void {
    // 24:00 is midnight of the next day, which the clock stores as minute 0.
    // Without the wrap the loop chases a minute value the clock never holds
    // and burns all 1440 advances before the guard stops it.
    const target = Math.round(clamp01(hour / 24) * 1440) % 1440;
    let guard = 0;
    while (this.minutes !== target && guard < 1440) {
      this.advanceMinute();
      guard += 1;
    }
  }

  /** Formats as "7:05 AM" for the HUD. */
  format(): string {
    const h24 = this.hour;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const mm = String(this.minuteOfHour).padStart(2, '0');
    return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
  }

  load(day: number, minutes: number): void {
    this.day = Math.max(1, Math.floor(day));
    // A stored 1440 means midnight; the clock only ever holds 0..1439.
    this.minutes = (clamp01(minutes / 1440) * 1440) % 1440;
    this.lastHour = this.hour;
    this.lastPhase = this.phase;
  }
}
