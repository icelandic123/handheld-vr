/**
 * All sound is synthesised with WebAudio: no audio files, nothing to license.
 *
 * Cues can also be recorded with the story clock and replayed into an
 * OfflineAudioContext, which is how the demo video gets its soundtrack.
 */
export type CueName = 'progress' | 'success' | 'pageTurn' | 'bark' | 'boing' | 'chirp' | 'honk' | 'bloop' | 'lampOn' | 'applause' | 'curtain';
export interface CueEvent {
  t: number;
  cue: CueName;
  args: number[];
}

export class TheatreAudio {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  /** Added to the context clock; lets an offline replay schedule cues at their story time. */
  private offset = 0;
  /** When set, every cue is logged with this clock (seconds). */
  recording: { clock: () => number; events: CueEvent[] } | null = null;

  private now(): number {
    return (this.ctx?.currentTime ?? 0) + this.offset;
  }

  private note(cue: CueName, args: number[] = []): void {
    this.recording?.events.push({ t: this.recording.clock(), cue, args });
  }

  /** Must be called from a user gesture (e.g. entering XR). */
  start(): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext) void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.attach(new Ctor());
  }

  /** Replay recorded cues offline and return the mixed soundtrack. */
  static async render(events: CueEvent[], seconds: number, sampleRate = 44100): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    const a = new TheatreAudio();
    a.attach(ctx);
    for (const e of events) {
      if (e.t < 0 || e.t > seconds) continue;
      a.offset = e.t;
      (a[e.cue] as (...x: number[]) => void).apply(a, e.args);
    }
    return ctx.startRendering();
  }

  private attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    // Lamp ambience: very quiet filtered noise with slow flicker.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.05;
    src.connect(lp).connect(this.hum).connect(this.master);
    src.start();
  }

  /** Soft rising tone that follows the match score (0..1). */
  private lastPing = 0;
  progress(score: number): void {
    this.note('progress', [score]);
    if (!this.ctx || !this.master) return;
    const now = this.now();
    if (score > 0.55 && now - this.lastPing > 0.45) {
      this.lastPing = now;
      this.tone(330 + score * 330, 0.04 * score, 0.25, 'sine');
    }
  }

  /** Little pentatonic arpeggio when a puppet comes alive. */
  success(): void {
    this.note('success');
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.12, 1.2, 'triangle', i * 0.09));
  }

  /** Paper rustle for a page turn. */
  pageTurn(): void {
    this.note('pageTurn');
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.35);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((Math.PI * i) / len);
      d[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(bp).connect(g).connect(this.master);
    src.start(this.now());
  }

  /** Dog bark: a short noisy formant burst with a falling pitch, twice. */
  bark(): void {
    this.note('bark');
    for (const d of [0, 0.28]) {
      this.sweep(420, 170, 0.16, 'sawtooth', 0.13, d, 900);
      this.noiseBurst(0.12, 0.08, 1200, d);
    }
  }

  /** Rabbit hop: springy upward sweep. */
  boing(): void {
    this.note('boing');
    this.sweep(180, 720, 0.25, 'sine', 0.12, 0);
    this.sweep(240, 900, 0.22, 'sine', 0.08, 0.32);
  }

  /** Bird: a few quick chirps. */
  chirp(): void {
    this.note('chirp');
    for (let i = 0; i < 5; i++) this.sweep(2200 + i * 120, 3400, 0.07, 'sine', 0.06, i * 0.11);
  }

  /** Swan: two nasal honks. */
  honk(): void {
    this.note('honk');
    for (const d of [0, 0.34]) this.sweep(330, 280, 0.22, 'sawtooth', 0.09, d, 1100);
  }

  /** Snail: a slow, soft, rising bloop. */
  bloop(): void {
    this.note('bloop');
    this.sweep(160, 420, 0.5, 'sine', 0.14, 0);
    this.tone(523.25, 0.05, 0.6, 'sine', 0.45);
  }

  /** Lamp waking: warm chord swell plus a soft click. */
  lampOn(): void {
    this.note('lampOn');
    this.noiseBurst(0.03, 0.15, 3000, 0);
    [261.63, 329.63, 392.0].forEach((f, i) => this.tone(f, 0.07, 2.2, 'sine', 0.05 + i * 0.04));
  }

  /** Applause: many short noise claps with a swelling envelope. */
  applause(seconds = 3.5): void {
    this.note('applause', [seconds]);
    for (let i = 0; i < seconds * 35; i++) {
      const t = Math.random() * seconds;
      const env = Math.sin((Math.PI * t) / seconds);
      this.noiseBurst(0.025, 0.05 * env + 0.01, 1500 + Math.random() * 2500, t);
    }
  }

  /** Curtain: long low rustle. */
  curtain(): void {
    this.note('curtain');
    this.noiseBurst(1.4, 0.18, 700, 0);
  }

  private sweep(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay: number, lowpass = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = this.now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = osc;
    if (lowpass > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lowpass;
      osc.connect(lp);
      node = lp;
    }
    node.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noiseBuffer: AudioBuffer | null = null;
  private noiseBurst(dur: number, gain: number, bandHz: number, delay: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = this.now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = bandHz;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.02);
  }

  private tone(freq: number, gain: number, dur: number, type: OscillatorType, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = this.now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}
