import { clamp01, damp } from '@/util/math';
import { mixToMono } from './downmix';
import {
  AMBIENCE_BY_ID,
  MUSIC_BY_ID,
  SOUNDS,
  SOUNDS_BY_ID,
  type AmbienceDef,
  type AmbienceId,
  type MusicDef,
  type SfxChannel,
  type SoundDef,
  type SynthSpec,
} from './sounds';

interface ChannelStrip {
  gain: GainNode;
  target: number;
}

interface AmbienceVoice {
  def: AmbienceDef;
  gain: GainNode;
  target: number;
  nodes: AudioNode[];
}

/**
 * Mixer-first audio architecture: four channels (music, sfx, ui, ambience) hang
 * off a master bus, and sources are looked up by id from the data files. The
 * placeholder synthesiser exists only behind `playSound`/`setAmbience`, so
 * swapping in recorded assets is a data change rather than a code change.
 */
/** Cutoff of the submerge filter when the player is dry — effectively bypassed. */
const DRY_CUTOFF_HZ = 20000;
/** ...and when they are fully under, where only the low end carries. */
const SUBMERGED_CUTOFF_HZ = 520;

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * Sits between the master bus and the speakers so everything — music,
   * ambience, the splash the player just made — goes muffled together when the
   * surface closes over their head. Wide open the rest of the time.
   */
  private submerged: BiquadFilterNode | null = null;
  private submergedAmount = 0;
  private channels = new Map<SfxChannel, ChannelStrip>();
  private ambienceVoices = new Map<AmbienceId, AmbienceVoice>();
  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<string, number>();
  private noiseBuffer: AudioBuffer | null = null;

  private musicVoice: { def: MusicDef; gain: GainNode; stop: () => void } | null = null;
  private musicSchedulerId = 0;
  private pendingMusic: string | null = null;

  private volumes = { master: 0.8, music: 0.55, sfx: 0.85, ui: 0.8, ambience: 0.7 };
  private started = false;
  muted = false;

  /** Web Audio cannot start before a gesture, so the first input unlocks it. */
  unlock(): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volumes.master;
      this.submerged = this.ctx.createBiquadFilter();
      this.submerged.type = 'lowpass';
      this.submerged.frequency.value = DRY_CUTOFF_HZ;
      this.submerged.Q.value = 0.7;
      this.master.connect(this.submerged);
      this.submerged.connect(this.ctx.destination);
      // A filter created after the player had already gone under would sit
      // wide open until they surfaced and dived again.
      if (this.submergedAmount > 0) this.setUnderwater(this.submergedAmount);

      for (const name of ['music', 'sfx', 'ui', 'ambience'] as SfxChannel[]) {
        const gain = this.ctx.createGain();
        gain.gain.value = this.volumeFor(name);
        gain.connect(this.master);
        this.channels.set(name, { gain, target: this.volumeFor(name) });
      }

      this.noiseBuffer = this.createNoiseBuffer();
      this.started = true;
      void this.preloadSources();
      if (this.pendingMusic) {
        const id = this.pendingMusic;
        this.pendingMusic = null;
        this.playMusic(id);
      }
    } catch (err) {
      console.warn('[audio] Web Audio unavailable', err);
    }
  }

  get isReady(): boolean {
    return this.started && !!this.ctx;
  }

  private volumeFor(channel: SfxChannel): number {
    switch (channel) {
      case 'music': return this.volumes.music;
      case 'ambience': return this.volumes.ambience;
      case 'ui': return this.volumes.ui;
      default: return this.volumes.sfx;
    }
  }

  setVolumes(v: Partial<typeof this.volumes>): void {
    Object.assign(this.volumes, v);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volumes.master;
    for (const [name, strip] of this.channels) strip.target = this.volumeFor(name);
  }

  /**
   * Muffles the whole mix. 0 is dry, 1 is fully under.
   *
   * Stored even before Web Audio has started, so a dive that begins before the
   * first gesture unlocks the context still sounds right once it does.
   */
  setUnderwater(amount: number): void {
    this.submergedAmount = clamp01(amount);
    if (!this.submerged || !this.ctx) return;
    const cutoff = DRY_CUTOFF_HZ * Math.pow(SUBMERGED_CUTOFF_HZ / DRY_CUTOFF_HZ, this.submergedAmount);
    this.rampFrequencyTo(this.submerged.frequency, cutoff, 0.35);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.rampTo(this.master.gain, muted ? 0 : this.volumes.master, 0.25);
  }

  /**
   * Fetches every sound that names a real file, so `playSound` finds a buffer
   * instead of falling through to the synthesiser.
   *
   * This is what makes filling in `src` a pure data change: the table in
   * `sounds.ts` decides what is real, and nothing else in the codebase has to
   * know which sounds have been recorded yet. Loads run in the background after
   * the audio context unlocks — a sound that has not arrived yet simply plays
   * its placeholder, and one that fails to load keeps playing it forever, so a
   * missing or broken file degrades to the old behaviour rather than silence.
   */
  private async preloadSources(): Promise<void> {
    const base = import.meta.env.BASE_URL ?? '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    await Promise.all(
      SOUNDS.flatMap((def) => (def.src ? [this.loadBuffer(def.id, `${prefix}${def.src}`)] : [])),
    );
  }

  /** Registers a decoded file for an id, taking priority over the synth fallback. */
  async loadBuffer(id: string, url: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(raw);
      this.buffers.set(id, SOUNDS_BY_ID.get(id)?.mono ? this.toMono(decoded) : decoded);
    } catch (err) {
      console.warn(`[audio] Failed to load ${url}; keeping placeholder`, err);
    }
  }

  /**
   * Collapses a decoded buffer to one channel, for sounds flagged `mono` in
   * `sounds.ts` because they will be positioned in the world.
   *
   * Already-mono input is returned untouched rather than copied.
   */
  private toMono(buffer: AudioBuffer): AudioBuffer {
    const ctx = this.ctx!;
    if (buffer.numberOfChannels <= 1) return buffer;

    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

    const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
    mixToMono(channels, mono.getChannelData(0));
    return mono;
  }

  playSound(id: string, options: { volume?: number; rate?: number } = {}): void {
    if (!this.ctx || !this.started || this.muted) return;
    const def = SOUNDS_BY_ID.get(id);
    if (!def) return;

    const now = this.ctx.currentTime;
    if (def.throttle) {
      const last = this.lastPlayed.get(id) ?? -Infinity;
      if (now - last < def.throttle) return;
      this.lastPlayed.set(id, now);
    }

    const channel = this.channels.get(def.channel);
    if (!channel) return;

    const volume = (def.baseVolume ?? 1) * (options.volume ?? 1);
    const buffer = this.buffers.get(id);
    if (buffer) {
      this.playBuffer(buffer, channel.gain, volume, options.rate ?? 1);
      return;
    }
    if (def.synth) this.playSynth(def, def.synth, channel.gain, volume, options.rate ?? 1);
  }

  private playBuffer(buffer: AudioBuffer, dest: AudioNode, volume: number, rate: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(dest);
    src.start();
    src.onended = () => gain.disconnect();
  }

  private playSynth(def: SoundDef, spec: SynthSpec, dest: AudioNode, volume: number, rate: number): void {
    const ctx = this.ctx!;
    const repeats = spec.repeats ?? 1;
    const interval = spec.repeatInterval ?? spec.duration;
    const jitter = def.pitchJitter ? Math.pow(2, ((Math.random() * 2 - 1) * def.pitchJitter) / 1200) : 1;

    for (let i = 0; i < repeats; i++) {
      const start = ctx.currentTime + i * interval;
      const detune = Math.pow(2, ((spec.repeatDetune ?? 0) * i) / 12);
      const f0 = spec.freq * jitter * rate * detune;
      const f1 = (spec.freqTo ?? spec.freq) * jitter * rate * detune;

      const env = ctx.createGain();
      const peak = volume * spec.gain;
      const attack = Math.max(0.004, spec.duration * (spec.attack ?? 0.08));
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
      env.connect(dest);

      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(f0, start);
      if (spec.freqTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + spec.duration);
      osc.connect(env);
      osc.start(start);
      osc.stop(start + spec.duration + 0.02);

      if (spec.noise && this.noiseBuffer) {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = spec.noise.lowpass;
        let chain: AudioNode = lp;
        if (spec.noise.highpass) {
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = spec.noise.highpass;
          lp.connect(hp);
          chain = hp;
        }
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, start);
        noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * spec.noise.amount), start + attack);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);
        noise.connect(lp);
        chain.connect(noiseGain).connect(dest);
        noise.start(start);
        noise.stop(start + spec.duration + 0.02);
      }
    }
  }

  // --- Ambience ----------------------------------------------------------

  /** Sets the target level of one ambience bed; it fades rather than cuts. */
  setAmbience(id: AmbienceId, level: number): void {
    const target = clamp01(level);
    if (!this.ctx || !this.started) return;

    const existing = this.ambienceVoices.get(id);
    if (existing) {
      existing.target = target * existing.def.volume;
      return;
    }
    if (target <= 0.001) return;
    const created = this.createAmbienceVoice(id);
    if (!created) return;
    created.target = target * created.def.volume;
    this.ambienceVoices.set(id, created);
  }

  private createAmbienceVoice(id: AmbienceId): AmbienceVoice | null {
    const def = AMBIENCE_BY_ID.get(id);
    const ctx = this.ctx;
    const channel = this.channels.get('ambience');
    if (!def || !ctx || !channel || !this.noiseBuffer) return null;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(channel.gain);

    const nodes: AudioNode[] = [];

    if (def.kind === 'chirp') {
      // Sparse pitched blips read as insects/birds better than filtered noise.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = def.highpass ?? 3000;
      const trem = ctx.createGain();
      trem.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = id === 'insects' ? 11 : 3.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(trem.gain);
      osc.connect(trem).connect(gain);
      osc.start();
      lfo.start();
      nodes.push(osc, lfo, trem, lfoGain);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = def.lowpass;
      let chain: AudioNode = lp;
      if (def.highpass) {
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = def.highpass;
        lp.connect(hp);
        chain = hp;
        nodes.push(hp);
      }
      src.connect(lp);
      chain.connect(gain);

      if (def.kind === 'surf' || def.kind === 'wind') {
        // Slow swell so the bed breathes instead of sitting flat.
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = def.kind === 'surf' ? 0.09 : 0.05;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = def.lowpass * 0.35;
        lfo.connect(lfoGain).connect(lp.frequency);
        lfo.start();
        nodes.push(lfo, lfoGain);
      }
      src.start();
      nodes.push(src, lp);
    }

    return { def, gain, target: 0, nodes };
  }

  // --- Music -------------------------------------------------------------

  playMusic(id: string | null): void {
    if (!this.started) {
      this.pendingMusic = id;
      return;
    }
    if (this.musicVoice && MUSIC_BY_ID.get(id ?? '') === this.musicVoice.def) return;

    if (this.musicVoice) {
      const old = this.musicVoice;
      this.rampTo(old.gain.gain, 0, 1.6);
      window.setTimeout(() => old.stop(), 1800);
      this.musicVoice = null;
    }
    window.clearInterval(this.musicSchedulerId);
    if (!id) return;

    const def = MUSIC_BY_ID.get(id);
    const ctx = this.ctx;
    const channel = this.channels.get('music');
    if (!def || !ctx || !channel) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(channel.gain);
    this.rampTo(gain.gain, def.volume, 2.2);

    // A held pad plus a scheduled arpeggio: enough shape to read as music while
    // remaining trivially replaceable by a real loop.
    const padNodes: AudioNode[] = [];
    for (const semitone of def.pad) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = def.root * Math.pow(2, semitone / 12) * 0.5;
      const padGain = ctx.createGain();
      padGain.gain.value = 0.12 / def.pad.length;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400 + def.brightness * 2200;
      osc.connect(padGain).connect(filter).connect(gain);
      osc.start();
      padNodes.push(osc, padGain, filter);
    }

    let step = 0;
    const beat = 60 / def.tempo;
    const scheduleNote = () => {
      if (!this.ctx) return;
      const degree = def.scale[(step * 3) % def.scale.length];
      const octave = step % 8 < 4 ? 1 : 2;
      const freq = def.root * Math.pow(2, degree / 12) * octave;
      const now = this.ctx.currentTime + 0.02;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const noteGain = this.ctx.createGain();
      const peak = 0.09 * (step % 4 === 0 ? 1.25 : 0.8);
      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.exponentialRampToValueAtTime(peak, now + 0.03);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + beat * 1.6);
      osc.connect(noteGain).connect(gain);
      osc.start(now);
      osc.stop(now + beat * 1.7);
      step += 1;
    };

    this.musicSchedulerId = window.setInterval(scheduleNote, beat * 1000);
    scheduleNote();

    this.musicVoice = {
      def,
      gain,
      stop: () => {
        for (const node of padNodes) {
          if ('stop' in node) (node as OscillatorNode).stop();
          node.disconnect();
        }
        gain.disconnect();
      },
    };
  }

  get currentMusicId(): string | null {
    return this.musicVoice?.def.id ?? this.pendingMusic;
  }

  // --- Frame -------------------------------------------------------------

  update(dt: number): void {
    if (!this.ctx) return;
    for (const strip of this.channels.values()) {
      strip.gain.gain.value = damp(strip.gain.gain.value, this.muted ? 0 : strip.target, 0.25, dt);
    }
    for (const [id, voice] of this.ambienceVoices) {
      voice.gain.gain.value = damp(voice.gain.gain.value, voice.target, 0.9, dt);
      // Retire fully-faded beds so idle interiors stop paying for ocean noise.
      if (voice.target <= 0.0005 && voice.gain.gain.value < 0.0008) {
        for (const node of voice.nodes) {
          if ('stop' in node) {
            try { (node as OscillatorNode).stop(); } catch { /* already stopped */ }
          }
          node.disconnect();
        }
        voice.gain.disconnect();
        this.ambienceVoices.delete(id);
      }
    }
  }

  /**
   * Ramps a filter cutoff, exponentially.
   *
   * Cutoff is a pitch, and a linear ramp from 20 kHz to 500 Hz spends most of
   * its travel among frequencies nobody can tell apart — the muffling would
   * arrive all at once at the end of the ramp instead of following the head
   * going under. `exponentialRampToValueAtTime` refuses a zero or negative
   * target, so the value is floored; both ends of this ramp are well above it
   * anyway, and the fallback keeps a browser without the method working.
   */
  private rampFrequencyTo(param: AudioParam, value: number, seconds: number): void {
    if (!this.ctx) return;
    const target = Math.max(20, value);
    if (typeof param.exponentialRampToValueAtTime !== 'function') {
      this.rampTo(param, target, seconds);
      return;
    }
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    // The curve is undefined from zero, so it has to start from a real value.
    param.setValueAtTime(Math.max(20, param.value), now);
    param.exponentialRampToValueAtTime(target, now + seconds);
  }

  private rampTo(param: AudioParam, value: number, seconds: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  private createNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise: smoother and less hissy than white for surf and wind.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  }
}
