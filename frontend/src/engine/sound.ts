// Tiny synthesized SFX — no audio assets, just oscillators with a
// quick exponential envelope. Created lazily on first user gesture.

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

class Sound {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur = 0.12, type: OscillatorType = 'sine', gain = 0.05, when = 0): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(ctx.destination);
    const t0 = ctx.currentTime + when;
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  playOpen(): void {
    this.tone(660, 0.07, 'triangle', 0.035);
  }

  playApply(): void {
    this.tone(523.25, 0.09, 'sine', 0.05);
    this.tone(783.99, 0.12, 'sine', 0.045, 0.06);
  }

  playReveal(score: number): void {
    const notes = score >= 85
      ? [523.25, 659.25, 783.99, 1046.5]
      : score >= 60
        ? [523.25, 659.25, 783.99]
        : [392, 349.23];
    notes.forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.05, i * 0.1));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const sound = new Sound();
