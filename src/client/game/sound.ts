/** Small synthesized effects. Audio is only created inside a user gesture. */
export class ArenaSound {
  private context: AudioContext | null = null;
  private muted = true;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.unlock();
  }

  unlock(): void {
    if (this.muted || typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  hit(strength: number): void {
    const context = this.context;
    if (!context || this.muted || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const time = context.currentTime;
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(110 + strength * 5, time);
    oscillator.frequency.exponentialRampToValueAtTime(34, time + 0.13);
    gain.gain.setValueAtTime(0.075, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.17);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  dispose(): void {
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
