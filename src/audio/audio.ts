/**
 * Fully procedural WebAudio: engine, siren, rain, ambient music and one-shot
 * effects. No audio files are shipped.
 */

import { clamp } from '../core/math';
import { events } from '../core/events';
import { GameSettings } from '../core/settings';

interface AudioUpdate {
  driving: boolean;
  speed: number;
  throttle: number;
  wanted: number;
  policeDistance: number;
  rain: number;
  night: number;
}

const CHORDS: number[][] = [
  [110, 130.81, 164.81, 220], // Am
  [87.31, 110, 130.81, 174.61], // F
  [130.81, 164.81, 196, 261.63], // C
  [98, 123.47, 146.83, 196], // G
];

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;

  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private musicOscs: OscillatorNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private rainSource: AudioBufferSourceNode | null = null;

  private settings: GameSettings;
  private started = false;
  private chordTimer = 0;
  private chordIndex = 0;
  private sirenTime = 0;
  private playerX = 0;
  private playerZ = 0;
  private disposed = false;

  constructor(settings: GameSettings) {
    this.settings = settings;
    const offs = [
      events.on('audio:gunshot', ({ x, z, kind }) => this.playGunshot(x, z, kind)),
      events.on('audio:explosion', ({ x, z }) => this.playExplosion(x, z)),
      events.on('audio:honk', ({ x, z }) => this.playHonk(x, z)),
      events.on('audio:crash', ({ x, z, impact }) => this.playCrash(x, z, impact)),
    ];
    this.cleanup = () => offs.forEach((off) => off());
  }

  private cleanup: () => void;

  get ready(): boolean {
    return this.started;
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.started = true;
  }

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.settings.musicVolume * 0.22;
    this.musicGain.connect(this.master);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.settings.sfxVolume;
    this.sfxGain.connect(this.master);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);

    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.master);

    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenGain.connect(this.master);

    // engine
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 520;
    this.engineFilter.Q.value = 2.2;
    this.engineFilter.connect(this.engineGain);
    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscA.frequency.value = 55;
    const gainA = ctx.createGain();
    gainA.gain.value = 0.5;
    this.engineOscA.connect(gainA).connect(this.engineFilter);
    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = 'square';
    this.engineOscB.frequency.value = 27.5;
    const gainB = ctx.createGain();
    gainB.gain.value = 0.22;
    this.engineOscB.connect(gainB).connect(this.engineFilter);
    this.engineOscA.start();
    this.engineOscB.start();

    // siren
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenOsc.frequency.value = 720;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = 'bandpass';
    sirenFilter.frequency.value = 800;
    sirenFilter.Q.value = 1.2;
    this.sirenOsc.connect(sirenFilter).connect(this.sirenGain);
    this.sirenOsc.start();

    // noise buffer for rain / impacts
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    // rain loop
    const rain = ctx.createBufferSource();
    rain.buffer = buffer;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1500;
    rainFilter.Q.value = 0.5;
    rain.connect(rainFilter).connect(this.rainGain);
    rain.start();
    this.rainSource = rain;

    // ambient music pad
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = CHORDS[0][i];
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.5 : 0.26;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      osc.connect(g).connect(filter).connect(this.musicGain);
      osc.start();
      this.musicOscs.push(osc);
    }
  }

  setVolumes(): void {
    const s = this.settings;
    if (this.musicGain) this.musicGain.gain.value = s.musicVolume * 0.22;
    if (this.sfxGain) this.sfxGain.gain.value = s.sfxVolume;
  }

  /** Freeze the audio graph while the game is paused or backgrounded. */
  setSuspended(suspended: boolean): void {
    if (!this.ctx || !this.started) return;
    if (suspended) {
      if (this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
      return;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  private spatial(x: number, z: number, falloff = 130): number {
    const d = Math.hypot(x - this.playerX, z - this.playerZ);
    return clamp(1 - d / falloff, 0, 1);
  }

  update(dt: number, state: AudioUpdate): void {
    const ctx = this.ctx;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;

    // engine
    if (this.engineGain && this.engineOscA && this.engineOscB && this.engineFilter) {
      const target = state.driving
        ? (0.05 + clamp(state.throttle, 0, 1) * 0.08 + clamp(state.speed / 45, 0, 1) * 0.09) *
          this.settings.engineVolume
        : 0;
      this.engineGain.gain.setTargetAtTime(target, now, 0.12);
      const rpm = 42 + clamp(state.speed / 40, 0, 1) * 110 + state.throttle * 22;
      this.engineOscA.frequency.setTargetAtTime(rpm, now, 0.15);
      this.engineOscB.frequency.setTargetAtTime(rpm * 0.5, now, 0.15);
      this.engineFilter.frequency.setTargetAtTime(320 + rpm * 4.2, now, 0.2);
    }

    // siren
    if (this.sirenGain && this.sirenOsc) {
      this.sirenTime += dt;
      const near =
        state.wanted > 0 && state.policeDistance < 150
          ? clamp(1 - state.policeDistance / 150, 0, 1) * (0.06 + state.wanted * 0.02)
          : 0;
      this.sirenGain.gain.setTargetAtTime(near, now, 0.2);
      const wobble = Math.sin(this.sirenTime * Math.PI * 1.4) > 0 ? 1 : 0.74;
      this.sirenOsc.frequency.setTargetAtTime(760 * wobble, now, 0.03);
    }

    // rain
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(state.rain * 0.16, now, 0.4);
    }

    // ambient chord progression
    this.chordTimer += dt;
    if (this.chordTimer > 9) {
      this.chordTimer = 0;
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      const chord = CHORDS[this.chordIndex];
      for (let i = 0; i < this.musicOscs.length; i++) {
        this.musicOscs[i].frequency.setTargetAtTime(chord[i] ?? chord[0], now, 1.8);
      }
    }
    if (this.musicGain) {
      const target = this.settings.musicVolume * (state.night > 0.6 ? 0.26 : 0.2);
      this.musicGain.gain.setTargetAtTime(target, now, 1.5);
    }
  }

  updatePosition(x: number, z: number): void {
    this.playerX = x;
    this.playerZ = z;
  }

  private noise(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  playGunshot(x: number, z: number, kind: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || !this.sfxGain) return;
    const vol = this.spatial(x, z, 160) * this.settings.sfxVolume;
    if (vol < 0.01) return;
    const now = ctx.currentTime;
    const power = kind === 'shotgun' ? 1.5 : kind === 'smg' ? 0.8 : 1;
    const noise = this.noise();
    if (noise) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = kind === 'shotgun' ? 900 : 1700;
      filter.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4 * vol * power, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      noise.connect(filter).connect(g).connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.2);
    }
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(50, now + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.35 * vol * power, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    thump.connect(tg).connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.18);
  }

  playExplosion(x: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || !this.sfxGain) return;
    const vol = Math.max(0.25, this.spatial(x, z, 400)) * this.settings.sfxVolume;
    const now = ctx.currentTime;
    const noise = this.noise();
    if (noise) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.65 * vol, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      noise.connect(filter).connect(g).connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 1.5);
    }
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(70, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.9);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.6 * vol, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    boom.connect(bg).connect(this.sfxGain);
    boom.start(now);
    boom.stop(now + 1.2);
  }

  playHonk(x: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || !this.sfxGain) return;
    const vol = this.spatial(x, z, 90) * this.settings.sfxVolume;
    if (vol < 0.01) return;
    const now = ctx.currentTime;
    for (const freq of [392, 494]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09 * vol, now + 0.02);
      g.gain.setValueAtTime(0.09 * vol, now + 0.22);
      g.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.connect(g).connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  }

  playCrash(x: number, z: number, impact: number): void {
    if (impact < 1) return;
    const ctx = this.ctx;
    if (!ctx || !this.started || !this.sfxGain) return;
    const vol = this.spatial(x, z, 110) * this.settings.sfxVolume * clamp(impact / 18, 0.1, 1);
    const now = ctx.currentTime;
    const noise = this.noise();
    if (!noise) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    noise.connect(filter).connect(g).connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.3);
  }

  thunder(): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || !this.sfxGain) return;
    const now = ctx.currentTime;
    const noise = this.noise();
    if (!noise) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * this.settings.sfxVolume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2.4);
    noise.connect(filter).connect(g).connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 2.5);
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();
    try {
      this.rainSource?.stop();
      this.engineOscA?.stop();
      this.engineOscB?.stop();
      this.sirenOsc?.stop();
      for (const o of this.musicOscs) o.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
