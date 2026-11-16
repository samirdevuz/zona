/**
 * Procedurally synthesized placeholder SFX (GAME.md 12): filtered noise bursts
 * for shots, thumps for hits, simple tones for UI. Positional audio through
 * PannerNode with distance rolloff. Categories: master, sfx, ui.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private noise!: AudioBuffer;
  private voices = 0;
  private readonly maxVoices = 16;
  private volume = 0.8;
  private sfxVolume = 1;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.volume, this.sfxVolume);
  }

  setVolumes(master: number, sfx: number): void {
    this.volume = master;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.sfx.gain.value = sfx;
    this.ui.gain.value = 0.7;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    }
  }

  private out(pos: { x: number; y: number; z: number } | null, bus: GainNode): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return bus;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 6;
    p.rolloffFactor = 1.1;
    p.maxDistance = 500;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(bus);
    return p;
  }

  private voice(dur: number): boolean {
    if (!this.ctx || this.voices >= this.maxVoices) return false;
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 50);
    return true;
  }

  /** Rifle shot. `pos` null = the local player's own gun. */
  shot(pos: { x: number; y: number; z: number } | null): void {
    if (!this.voice(0.25)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(pos, this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(pos ? 2600 : 5200, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(pos ? 0.9 : 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, 0.25);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(pos ? 0.5 : 0.45, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(dest);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, bus?: GainNode, endFreq?: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(bus ?? this.ui);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hitMarker(head: boolean, kill: boolean): void {
    this.tone(head ? 2400 : 1700, 0.05, 0.25, 'square');
    if (kill) this.tone(900, 0.12, 0.25, 'triangle', 0.06);
  }

  damaged(): void {
    if (!this.ctx) return;
    this.tone(110, 0.18, 0.6, 'sine', 0, this.sfx, 50);
  }

  reload(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const d of [0, 0.35, 1.6]) {
      const t = ctx.currentTime + d;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(f).connect(g).connect(this.sfx);
      src.start(t, Math.random(), 0.05);
    }
  }

  empty(): void {
    this.tone(2600, 0.03, 0.15, 'square', 0, this.sfx);
  }

  captured(good: boolean): void {
    const notes = good ? [523, 659, 784] : [523, 415, 330];
    notes.forEach((f, i) => this.tone(f, 0.18, 0.22, 'triangle', i * 0.11));
  }

  countdown(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.3 : 0.12, 0.2, 'sine');
  }
}
