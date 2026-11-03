/** Small synthesized effects. Audio is only created inside a user gesture. */
export class ArenaSound {
  private context: AudioContext | null = null;
  private muted = true;
  private master: GainNode | null = null;
  private rotor: OscillatorNode | null = null;
  private harmonic: OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private drive: OscillatorNode | null = null;
  private driveGain: GainNode | null = null;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) this.unlock();
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.75, this.context.currentTime, 0.03);
  }

  unlock(): void {
    if (this.muted || typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    if (!this.master) {
      const context = this.context;
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.75;
      this.master.connect(context.destination);
      this.rotor = context.createOscillator();
      this.rotor.type = 'sawtooth';
      this.harmonic = context.createOscillator();
      this.harmonic.type = 'triangle';
      this.rotorGain = context.createGain();
      this.rotorGain.gain.value = 0;
      const rotorFilter = context.createBiquadFilter();
      rotorFilter.type = 'lowpass';
      rotorFilter.frequency.value = 1_450;
      rotorFilter.Q.value = 0.6;
      this.rotor.connect(rotorFilter);
      this.harmonic.connect(rotorFilter);
      rotorFilter.connect(this.rotorGain);
      this.rotorGain.connect(this.master);
      this.drive = context.createOscillator();
      this.drive.type = 'triangle';
      this.driveGain = context.createGain();
      this.driveGain.gain.value = 0;
      this.drive.connect(this.driveGain);
      this.driveGain.connect(this.master);
      this.rotor.start();
      this.harmonic.start();
      this.drive.start();
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
  }

  motor(charge: number, speed: number, horizontal: boolean): void {
    const context = this.context;
    if (!context || this.muted || !this.rotor || !this.harmonic || !this.rotorGain || !this.drive || !this.driveGain) return;
    const time = context.currentTime;
    const rpm = Math.max(0, Math.min(1, charge));
    const movement = Math.max(0, Math.min(1, speed));
    const fundamental = (horizontal ? 32 : 53) + rpm * (horizontal ? 180 : 340);
    this.rotor.frequency.setTargetAtTime(fundamental, time, 0.08);
    this.harmonic.frequency.setTargetAtTime(fundamental * 2.03, time, 0.07);
    this.rotorGain.gain.setTargetAtTime(rpm * 0.022, time, 0.07);
    this.drive.frequency.setTargetAtTime(85 + movement * 180, time, 0.04);
    this.driveGain.gain.setTargetAtTime(movement * 0.025, time, 0.05);
  }

  hit(strength: number): void {
    const context = this.context;
    if (!context || !this.master || this.muted || context.state !== 'running') return;
    const amplitude = Math.max(0.02, Math.min(0.25, strength * 0.14));
    const impact = context.createBuffer(1, Math.ceil(context.sampleRate * 0.18), context.sampleRate);
    const samples = impact.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.035));
    const noise = context.createBufferSource();
    noise.buffer = impact;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 360;
    const gain = context.createGain();
    const time = context.currentTime;
    gain.gain.value = amplitude;
    noise.connect(filter); filter.connect(gain); gain.connect(this.master);
    noise.start();
    noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
    for (const frequency of [173, 487, 1_093]) {
      const ring = context.createOscillator();
      const envelope = context.createGain();
      ring.type = 'sine';
      ring.frequency.value = frequency;
      envelope.gain.setValueAtTime(amplitude * 0.21, time);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
      ring.connect(envelope); envelope.connect(this.master);
      ring.start(time); ring.stop(time + 0.25);
      ring.onended = () => { ring.disconnect(); envelope.disconnect(); };
    }
  }

  dispose(): void {
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.rotor = null;
    this.harmonic = null;
    this.rotorGain = null;
    this.drive = null;
    this.driveGain = null;
  }
}
