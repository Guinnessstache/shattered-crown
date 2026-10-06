// Synthesized sound effects (no audio files to download) and a low dungeon ambience.
export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.7; this.amb = null; }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  noise(dur, { type = 'bandpass', f0 = 1200, f1 = 400, q = 1, gain = 0.4, attack = 0.005 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, f1 = null, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.ctx || this.vol <= 0) return;
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'swing': this.noise(0.18, { f0: 2400 * r, f1: 500, q: 1.2, gain: 0.22, attack: 0.03 }); break;
      case 'hit': this.noise(0.12, { type: 'lowpass', f0: 1800, f1: 200, gain: 0.5 }); this.tone(110 * r, 0.12, { type: 'triangle', gain: 0.35, f1: 60 }); break;
      case 'crit': this.noise(0.14, { type: 'lowpass', f0: 2600, f1: 200, gain: 0.55 }); this.tone(1400 * r, 0.25, { type: 'square', gain: 0.06, f1: 900 }); this.tone(90, 0.18, { type: 'sine', gain: 0.5, f1: 45 }); break;
      case 'bonk': this.tone(700 * r, 0.1, { type: 'square', gain: 0.08, f1: 300 }); this.noise(0.08, { f0: 3000, f1: 1000, gain: 0.2 }); break;
      case 'block': this.tone(1800 * r, 0.22, { type: 'triangle', gain: 0.12, f1: 1500 }); this.noise(0.08, { f0: 5000, f1: 2000, gain: 0.25 }); break;
      case 'hurt': this.noise(0.15, { type: 'lowpass', f0: 900, f1: 150, gain: 0.45 }); this.tone(160, 0.15, { type: 'sawtooth', gain: 0.08, f1: 90 }); break;
      case 'die': this.noise(0.5, { type: 'lowpass', f0: 1200, f1: 80, gain: 0.35, attack: 0.02 }); this.tone(220 * r, 0.4, { type: 'sawtooth', gain: 0.05, f1: 70 }); break;
      case 'bones': for (let i = 0; i < 5; i++) this.tone(900 + Math.random() * 1200, 0.05, { type: 'triangle', gain: 0.07, delay: i * 0.05 }); this.noise(0.3, { f0: 3000, f1: 800, gain: 0.15 }); break;
      case 'break': this.noise(0.35, { type: 'lowpass', f0: 1600, f1: 100, gain: 0.5 }); for (let i = 0; i < 3; i++) this.tone(180 + Math.random() * 200, 0.08, { type: 'triangle', gain: 0.12, delay: i * 0.06 }); break;
      case 'gold': for (let i = 0; i < 3; i++) this.tone(2200 + i * 400 + Math.random() * 200, 0.12, { type: 'triangle', gain: 0.08, delay: i * 0.05 }); break;
      case 'pickup': this.tone(500, 0.08, { type: 'triangle', gain: 0.12 }); this.tone(750, 0.1, { type: 'triangle', gain: 0.1, delay: 0.06 }); break;
      case 'rare': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.1, delay: i * 0.07 })); break;
      case 'drop': this.tone(300, 0.12, { type: 'triangle', gain: 0.1, f1: 200 }); break;
      case 'potion': for (let i = 0; i < 4; i++) this.tone(300 + Math.random() * 300, 0.07, { gain: 0.12, delay: i * 0.07, f1: 600 }); break;
      case 'levelup': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.13, delay: i * 0.09 })); break;
      case 'chest': this.tone(140, 0.4, { type: 'sawtooth', gain: 0.06, f1: 90 }); this.noise(0.4, { f0: 600, f1: 200, gain: 0.15, attack: 0.1 }); break;
      case 'stairs': this.noise(0.9, { type: 'lowpass', f0: 500, f1: 80, gain: 0.3, attack: 0.2 }); break;
      case 'cleave': this.noise(0.4, { f0: 3000, f1: 300, q: 0.8, gain: 0.3, attack: 0.05 }); break;
      case 'bash': this.tone(80, 0.2, { gain: 0.6, f1: 40 }); this.noise(0.15, { type: 'lowpass', f0: 1500, f1: 100, gain: 0.5 }); break;
      case 'charge': this.noise(0.35, { f0: 600, f1: 2000, q: 0.7, gain: 0.25, attack: 0.05 }); break;
      case 'warcry': this.tone(130, 0.7, { type: 'sawtooth', gain: 0.12, f1: 180, attack: 0.05 }); this.tone(196, 0.7, { type: 'sawtooth', gain: 0.08, f1: 260, attack: 0.05 }); break;
      case 'arrow': this.noise(0.2, { f0: 4000, f1: 1500, q: 2, gain: 0.12 }); break;
      case 'fireball': this.noise(0.4, { type: 'lowpass', f0: 800, f1: 300, gain: 0.25, attack: 0.05 }); break;
      case 'slam': this.tone(55, 0.6, { gain: 0.7, f1: 30 }); this.noise(0.6, { type: 'lowpass', f0: 800, f1: 60, gain: 0.6 }); break;
      case 'tell': this.tone(110, 0.8, { type: 'sawtooth', gain: 0.08, f1: 70, attack: 0.3 }); break;
      case 'click': this.tone(900, 0.04, { type: 'square', gain: 0.04 }); break;
      case 'error': this.tone(180, 0.15, { type: 'square', gain: 0.06 }); break;
      default: break;
    }
  }

  ambience(kind) {
    if (!this.ctx) return;
    if (this.amb) { const a = this.amb; a.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => a.src.stop(), 2000); this.amb = null; }
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = kind === 'town' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'town' ? 900 : 180; f.Q.value = kind === 'town' ? 0.3 : 0.7;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(kind === 'town' ? 0.025 : 0.12, c.currentTime, 1.5);
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    this.amb = { src, g };
  }
}
