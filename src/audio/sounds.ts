/**
 * Sound definitions.
 *
 * Every entry can either point at a real file (`src`) or, until production
 * audio exists, describe a small synthesised placeholder. Dropping in finished
 * assets means filling in `src` — no gameplay code changes.
 */

export type SfxChannel = 'sfx' | 'ui' | 'ambience' | 'music';

export interface SynthSpec {
  type: OscillatorType;
  /** Start frequency in Hz. */
  freq: number;
  /** Frequency to glide to over the sound's length. */
  freqTo?: number;
  duration: number;
  gain: number;
  /** Attack fraction of the duration. */
  attack?: number;
  /** Adds a filtered noise burst — for footsteps, splashes, digging. */
  noise?: { amount: number; lowpass: number; highpass?: number };
  /** Repeats the body this many times, for chimes and coin counts. */
  repeats?: number;
  repeatInterval?: number;
  /** Semitone offset applied per repeat. */
  repeatDetune?: number;
}

export interface SoundDef {
  id: string;
  channel: SfxChannel;
  /** Path to a finished asset. Takes priority over `synth` once present. */
  src?: string;
  synth?: SynthSpec;
  /** Random pitch variation applied on each play, in cents. */
  pitchJitter?: number;
  /** Minimum seconds between plays, to stop rapid triggers stacking. */
  throttle?: number;
  loop?: boolean;
  baseVolume?: number;
}

export const SOUNDS: SoundDef[] = [
  // --- Footsteps ---------------------------------------------------------
  { id: 'step.grass', channel: 'sfx', pitchJitter: 220, throttle: 0.12, baseVolume: 0.35,
    synth: { type: 'triangle', freq: 150, freqTo: 90, duration: 0.13, gain: 0.3, noise: { amount: 0.8, lowpass: 1400 } } },
  { id: 'step.sand', channel: 'sfx', pitchJitter: 200, throttle: 0.12, baseVolume: 0.32,
    synth: { type: 'sine', freq: 110, freqTo: 70, duration: 0.16, gain: 0.26, noise: { amount: 1, lowpass: 900 } } },
  { id: 'step.wood', channel: 'sfx', pitchJitter: 160, throttle: 0.12, baseVolume: 0.4,
    synth: { type: 'square', freq: 210, freqTo: 120, duration: 0.1, gain: 0.22, noise: { amount: 0.35, lowpass: 2600 } } },
  { id: 'step.stone', channel: 'sfx', pitchJitter: 180, throttle: 0.12, baseVolume: 0.36,
    synth: { type: 'triangle', freq: 260, freqTo: 150, duration: 0.09, gain: 0.24, noise: { amount: 0.5, lowpass: 3200 } } },
  { id: 'step.water', channel: 'sfx', pitchJitter: 240, throttle: 0.14, baseVolume: 0.4,
    synth: { type: 'sine', freq: 320, freqTo: 160, duration: 0.22, gain: 0.28, noise: { amount: 1, lowpass: 2200, highpass: 400 } } },

  // --- Tools -------------------------------------------------------------
  { id: 'tool.cast', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'sine', freq: 900, freqTo: 320, duration: 0.35, gain: 0.3, noise: { amount: 0.5, lowpass: 5200, highpass: 900 } } },
  { id: 'tool.splash', channel: 'sfx', baseVolume: 0.55, pitchJitter: 150,
    synth: { type: 'sine', freq: 480, freqTo: 180, duration: 0.4, gain: 0.4, noise: { amount: 1, lowpass: 3400, highpass: 300 } } },
  { id: 'tool.reel', channel: 'sfx', throttle: 0.09, baseVolume: 0.32,
    synth: { type: 'sawtooth', freq: 380, freqTo: 420, duration: 0.1, gain: 0.16, noise: { amount: 0.3, lowpass: 4000 } } },
  { id: 'tool.bite', channel: 'sfx', baseVolume: 0.6,
    synth: { type: 'triangle', freq: 660, freqTo: 990, duration: 0.18, gain: 0.4, repeats: 2, repeatInterval: 0.1 } },
  { id: 'tool.net', channel: 'sfx', baseVolume: 0.45,
    synth: { type: 'sine', freq: 1200, freqTo: 500, duration: 0.24, gain: 0.22, noise: { amount: 0.8, lowpass: 7000, highpass: 1500 } } },
  { id: 'tool.dig', channel: 'sfx', baseVolume: 0.5, pitchJitter: 180,
    synth: { type: 'triangle', freq: 130, freqTo: 80, duration: 0.3, gain: 0.34, noise: { amount: 1, lowpass: 1300 } } },
  { id: 'tool.axe', channel: 'sfx', baseVolume: 0.55, pitchJitter: 120,
    synth: { type: 'square', freq: 190, freqTo: 95, duration: 0.22, gain: 0.34, noise: { amount: 0.7, lowpass: 2400 } } },
  { id: 'tool.shake', channel: 'sfx', baseVolume: 0.42,
    synth: { type: 'sine', freq: 420, freqTo: 260, duration: 0.42, gain: 0.2, noise: { amount: 1, lowpass: 5200, highpass: 1100 } } },
  { id: 'tool.water', channel: 'sfx', baseVolume: 0.45,
    synth: { type: 'sine', freq: 700, freqTo: 380, duration: 0.55, gain: 0.22, noise: { amount: 1, lowpass: 4200, highpass: 700 } } },
  { id: 'tool.plant', channel: 'sfx', baseVolume: 0.4,
    synth: { type: 'triangle', freq: 520, freqTo: 780, duration: 0.2, gain: 0.24 } },
  { id: 'tool.mine', channel: 'sfx', baseVolume: 0.55, pitchJitter: 140,
    synth: { type: 'square', freq: 240, freqTo: 110, duration: 0.2, gain: 0.3, noise: { amount: 0.9, lowpass: 3800 } } },

  // --- Items and progression --------------------------------------------
  { id: 'item.pickup', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'triangle', freq: 780, freqTo: 1180, duration: 0.16, gain: 0.26 } },
  { id: 'item.harvest', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'sine', freq: 620, duration: 0.3, gain: 0.26, repeats: 3, repeatInterval: 0.07, repeatDetune: 4 } },
  { id: 'money.coin', channel: 'sfx', throttle: 0.04, baseVolume: 0.4,
    synth: { type: 'sine', freq: 1560, freqTo: 2100, duration: 0.09, gain: 0.16 } },
  { id: 'money.sale', channel: 'sfx', baseVolume: 0.55,
    synth: { type: 'sine', freq: 880, duration: 0.42, gain: 0.24, repeats: 4, repeatInterval: 0.075, repeatDetune: 5 } },
  { id: 'catch.common', channel: 'sfx', baseVolume: 0.6,
    synth: { type: 'triangle', freq: 660, duration: 0.4, gain: 0.3, repeats: 3, repeatInterval: 0.09, repeatDetune: 4 } },
  { id: 'catch.rare', channel: 'sfx', baseVolume: 0.7,
    synth: { type: 'triangle', freq: 520, duration: 0.9, gain: 0.34, repeats: 6, repeatInterval: 0.11, repeatDetune: 3 } },
  { id: 'museum.donate', channel: 'sfx', baseVolume: 0.6,
    synth: { type: 'sine', freq: 440, duration: 1.1, gain: 0.28, repeats: 4, repeatInterval: 0.17, repeatDetune: 7 } },
  { id: 'friendship.up', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'sine', freq: 700, duration: 0.5, gain: 0.24, repeats: 3, repeatInterval: 0.1, repeatDetune: 5 } },
  { id: 'quest.complete', channel: 'sfx', baseVolume: 0.65,
    synth: { type: 'triangle', freq: 523, duration: 0.85, gain: 0.3, repeats: 4, repeatInterval: 0.14, repeatDetune: 4 } },

  // --- World -------------------------------------------------------------
  { id: 'door.open', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'sawtooth', freq: 210, freqTo: 130, duration: 0.4, gain: 0.18, noise: { amount: 0.4, lowpass: 1800 } } },
  { id: 'door.close', channel: 'sfx', baseVolume: 0.5,
    synth: { type: 'triangle', freq: 150, freqTo: 90, duration: 0.28, gain: 0.26, noise: { amount: 0.5, lowpass: 1200 } } },
  { id: 'thunder', channel: 'sfx', baseVolume: 0.7,
    synth: { type: 'sine', freq: 70, freqTo: 34, duration: 2.2, gain: 0.4, noise: { amount: 1, lowpass: 420 } } },

  // --- UI ----------------------------------------------------------------
  { id: 'ui.hover', channel: 'ui', throttle: 0.05, baseVolume: 0.22,
    synth: { type: 'sine', freq: 1100, duration: 0.05, gain: 0.1 } },
  { id: 'ui.select', channel: 'ui', baseVolume: 0.35,
    synth: { type: 'triangle', freq: 880, freqTo: 1320, duration: 0.1, gain: 0.16 } },
  { id: 'ui.back', channel: 'ui', baseVolume: 0.32,
    synth: { type: 'triangle', freq: 660, freqTo: 420, duration: 0.11, gain: 0.15 } },
  { id: 'ui.open', channel: 'ui', baseVolume: 0.38,
    synth: { type: 'sine', freq: 520, freqTo: 900, duration: 0.18, gain: 0.16 } },
  { id: 'ui.close', channel: 'ui', baseVolume: 0.35,
    synth: { type: 'sine', freq: 820, freqTo: 420, duration: 0.16, gain: 0.15 } },
  { id: 'ui.error', channel: 'ui', baseVolume: 0.4,
    synth: { type: 'square', freq: 200, freqTo: 150, duration: 0.16, gain: 0.12 } },
  { id: 'ui.talk', channel: 'ui', throttle: 0.03, baseVolume: 0.2,
    synth: { type: 'triangle', freq: 620, duration: 0.045, gain: 0.09 } },
];

export const SOUNDS_BY_ID = new Map(SOUNDS.map((s) => [s.id, s]));

/**
 * Music beds. Each is a short generative motif until real tracks land; the
 * `src` field is the hook for finished loops.
 */
export interface MusicDef {
  id: string;
  src?: string;
  /** Root note in Hz. */
  root: number;
  /** Scale degrees, in semitones from the root. */
  scale: number[];
  /** Beats per minute of the arpeggio. */
  tempo: number;
  /** Pad chord voicing in semitones. */
  pad: number[];
  brightness: number;
  volume: number;
}

export const MUSIC: MusicDef[] = [
  { id: 'music.title', root: 261.63, scale: [0, 2, 4, 7, 9, 12, 14], tempo: 68, pad: [0, 7, 16], brightness: 0.7, volume: 0.5 },
  { id: 'music.townDay', root: 293.66, scale: [0, 2, 4, 7, 9, 12], tempo: 84, pad: [0, 4, 7, 11], brightness: 0.85, volume: 0.42 },
  { id: 'music.townEvening', root: 220.0, scale: [0, 3, 5, 7, 10, 12], tempo: 62, pad: [0, 3, 7, 10], brightness: 0.45, volume: 0.4 },
  { id: 'music.beach', root: 329.63, scale: [0, 2, 5, 7, 9, 12], tempo: 74, pad: [0, 5, 9], brightness: 0.9, volume: 0.36 },
  { id: 'music.night', root: 196.0, scale: [0, 2, 3, 7, 8, 10], tempo: 52, pad: [0, 3, 7, 14], brightness: 0.3, volume: 0.34 },
  { id: 'music.rain', root: 233.08, scale: [0, 2, 3, 5, 7, 10], tempo: 58, pad: [0, 3, 7], brightness: 0.35, volume: 0.34 },
  { id: 'music.museum', root: 174.61, scale: [0, 4, 7, 11, 14], tempo: 44, pad: [0, 7, 11, 16], brightness: 0.55, volume: 0.32 },
  { id: 'music.home', root: 246.94, scale: [0, 2, 4, 7, 11], tempo: 60, pad: [0, 4, 9], brightness: 0.75, volume: 0.34 },
  { id: 'music.shop', root: 277.18, scale: [0, 2, 4, 6, 7, 9], tempo: 96, pad: [0, 4, 7], brightness: 0.95, volume: 0.36 },
];

export const MUSIC_BY_ID = new Map(MUSIC.map((m) => [m.id, m]));

/** Looping environmental beds, mixed by proximity/context rather than triggered. */
export type AmbienceId = 'ocean' | 'wind' | 'rain' | 'insects' | 'birds' | 'interior' | 'museum' | 'fire';

export interface AmbienceDef {
  id: AmbienceId;
  src?: string;
  /** Noise colour used by the placeholder generator. */
  kind: 'surf' | 'wind' | 'rain' | 'chirp' | 'room' | 'hum';
  lowpass: number;
  highpass?: number;
  volume: number;
}

export const AMBIENCE: AmbienceDef[] = [
  { id: 'ocean', kind: 'surf', lowpass: 900, volume: 0.5 },
  { id: 'wind', kind: 'wind', lowpass: 520, volume: 0.35 },
  { id: 'rain', kind: 'rain', lowpass: 5200, highpass: 700, volume: 0.6 },
  { id: 'insects', kind: 'chirp', lowpass: 7000, highpass: 2500, volume: 0.3 },
  { id: 'birds', kind: 'chirp', lowpass: 6000, highpass: 1800, volume: 0.24 },
  { id: 'interior', kind: 'room', lowpass: 400, volume: 0.22 },
  { id: 'museum', kind: 'hum', lowpass: 300, volume: 0.28 },
  { id: 'fire', kind: 'hum', lowpass: 1200, volume: 0.2 },
];

export const AMBIENCE_BY_ID = new Map(AMBIENCE.map((a) => [a.id, a]));
