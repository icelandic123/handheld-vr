/**
 * All sound is synthesised with WebAudio: no audio files, nothing to license.
 */
export class TheatreAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;

  /** Must be called from a user gesture (e.g. entering XR). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
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
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    if (score > 0.55 && now - this.lastPing > 0.45) {
      this.lastPing = now;
      this.tone(330 + score * 330, 0.04 * score, 0.25, 'sine');
    }
  }

  /** Little pentatonic arpeggio when a puppet comes alive. */
  success(): void {
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.12, 1.2, 'triangle', i * 0.09));
  }

  /** Paper rustle for a page turn. */
  pageTurn(): void {
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
    src.start();
  }

  /** Dog bark: a short noisy formant burst with a falling pitch, twice. */
  bark(): void {
    for (const d of [0, 0.28]) {
      this.sweep(420, 170, 0.16, 'sawtooth', 0.13, d, 900);
      this.noiseBurst(0.12, 0.08, 1200, d);
    }
  }

  /** Rabbit hop: springy upward sweep. */
  boing(): void {
    this.sweep(180, 720, 0.25, 'sine', 0.12, 0);
    this.sweep(240, 900, 0.22, 'sine', 0.08, 0.32);
  }

  /** Bird: a few quick chirps. */
  chirp(): void {
    for (let i = 0; i < 5; i++) this.sweep(2200 + i * 120, 3400, 0.07, 'sine', 0.06, i * 0.11);
  }

  /** Lamp waking: warm chord swell plus a soft click. */
  lampOn(): void {
    this.noiseBurst(0.03, 0.15, 3000, 0);
    [261.63, 329.63, 392.0].forEach((f, i) => this.tone(f, 0.07, 2.2, 'sine', 0.05 + i * 0.04));
  }

  /** Applause: many short noise claps with a swelling envelope. */
  applause(seconds = 3.5): void {
    for (let i = 0; i < seconds * 35; i++) {
      const t = Math.random() * seconds;
      const env = Math.sin((Math.PI * t) / seconds);
      this.noiseBurst(0.025, 0.05 * env + 0.01, 1500 + Math.random() * 2500, t);
    }
  }

  /** Curtain: long low rustle. */
  curtain(): void {
    this.noiseBurst(1.4, 0.18, 700, 0);
  }

  private sweep(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay: number, lowpass = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
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
    const t0 = ctx.currentTime + delay;
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
    const t0 = ctx.currentTime + delay;
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
