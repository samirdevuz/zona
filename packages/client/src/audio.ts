interface ShotProfile {
  rate: number;
  cut: number;
  decay: number;
  gain: number;
  thump: number;
  thumpGain: number;
}

/** Per-weapon shot synthesis (SFX pass, GAME.md 12). */
const SHOT_PROFILES: Record<string, ShotProfile> = {
  ar1: { rate: 1, cut: 5200, decay: 0.2, gain: 0.55, thump: 140, thumpGain: 0.45 },
  smg1: { rate: 1.25, cut: 6200, decay: 0.12, gain: 0.45, thump: 180, thumpGain: 0.3 },
  lmg1: { rate: 0.85, cut: 4200, decay: 0.24, gain: 0.6, thump: 110, thumpGain: 0.55 },
  bolt1: { rate: 0.7, cut: 7000, decay: 0.55, gain: 0.85, thump: 90, thumpGain: 0.7 },
  pistol: { rate: 1.15, cut: 5600, decay: 0.15, gain: 0.45, thump: 200, thumpGain: 0.3 },
  rocket: { rate: 0.6, cut: 1500, decay: 0.3, gain: 0.4, thump: 70, thumpGain: 0.5 },
};

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
  private readonly maxVoices = 24;
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

  /** Gun shot. `pos` null = the local player's own gun. Each weapon has its own synthesized profile. */
  shot(pos: { x: number; y: number; z: number } | null, weapon: string = 'ar1'): void {
    if (!this.voice(0.6)) return;
    const pr = SHOT_PROFILES[weapon] ?? SHOT_PROFILES.ar1!;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(pos, this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = pr.rate * (0.92 + Math.random() * 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(pos ? pr.cut * 0.5 : pr.cut, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + pr.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(pr.gain * (pos ? 1.5 : 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + pr.decay);
    src.connect(lp).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, pr.decay + 0.05);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(pr.thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(pr.thumpGain, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(dest);
    osc.start(t);
    osc.stop(t + 0.13);
    if (weapon === 'bolt1' && !pos) this.clicks([0.55, 0.85], 2400, 0.3);
  }

  /** Explosion: long low rumble + crack, positional. */
  explosion(pos: { x: number; y: number; z: number }): void {
    if (!this.voice(1.6)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(pos, this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(2.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    src.connect(lp).connect(g).connect(dest);
    src.start(t, 0, 1.5);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(og).connect(dest);
    osc.start(t);
    osc.stop(t + 0.72);
  }

  /** Rocket launch whoosh. */
  rocket(pos: { x: number; y: number; z: number } | null): void {
    if (!this.voice(0.8)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(pos, this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    src.connect(bp).connect(g).connect(dest);
    src.start(t, Math.random() * 0.2, 0.8);
  }

  /** Short filtered clicks (reload, bolt, deploy, switching). */
  private clicks(delays: number[], freq: number, gain: number, pos: { x: number; y: number; z: number } | null = null): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const dest = this.out(pos, this.sfx);
    for (const d of delays) {
      const t = ctx.currentTime + d;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(f).connect(g).connect(dest);
      src.start(t, Math.random(), 0.05);
    }
  }

  throwGrenade(): void {
    this.clicks([0, 0.12], 1800, 0.25);
  }

  bounce(pos: { x: number; y: number; z: number }): void {
    this.clicks([0], 3800, 0.35, pos);
  }

  deploy(): void {
    this.clicks([0, 0.08], 900, 0.5);
  }

  switchItem(): void {
    this.clicks([0, 0.15], 2900, 0.15);
  }

  torch(): void {
    if (!this.voice(0.15)) return;
    this.clicks([0, 0.05, 0.1], 5200, 0.12);
  }

  /** Footstep: soft low tap. Local steps quieter, remote ones positional. */
  footstep(pos: { x: number; y: number; z: number } | null, loud: boolean): void {
    if (!this.ctx || this.voices >= this.maxVoices - 4) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dest = this.out(pos, this.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420 + Math.random() * 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(pos ? (loud ? 0.9 : 0.5) : loud ? 0.22 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random(), 0.1);
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

  reload(seconds = 2): void {
    this.clicks([0, 0.35, Math.max(0.5, seconds - 0.5)], 3200, 0.35);
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
