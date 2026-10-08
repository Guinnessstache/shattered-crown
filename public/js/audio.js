// Sound effects: recorded clips (public/sfx, from Kenney's CC0 "RPG Audio" pack) layered with
// a little synthesis for weight, plus synthesized sounds for everything else and a low dungeon
// ambience. Until the clips have loaded (or if they fail) every sound falls back to synthesis.
const CLIPS = ['swing1', 'swing2', 'swing3', 'slice1', 'slice2', 'chop', 'clank1', 'clank2', 'clank3', 'latch', 'click',
  'coins1', 'coins2', 'leather1', 'leather2', 'leather3', 'drop', 'creak1', 'creak2', 'door'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.7; this.amb = null; this.buf = {}; this.last = {}; }

  // Fetch and decode the clips in the background (once the browser allows audio).
  load() {
    if (this.loading) return;
    this.loading = true;
    for (const n of CLIPS) {
      fetch(`/sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((a) => this.ctx.decodeAudioData(a)).then((b) => { this.buf[n] = b; }).catch(() => {});
    }
  }

  // Play one of `names` (a random one), slightly re-pitched each time so repeats don't sound
  // identical. Returns false if none has loaded yet, so the caller can synthesize instead.
  clip(names, { gain = 0.5, rate = [0.94, 1.08], delay = 0 } = {}) {
    const c = this.ctx; if (!c) return false;
    const have = names.filter((n) => this.buf[n]);
    if (!have.length) return false;
    // Don't pick the same file twice in a row when there's a choice.
    const key = names.join();
    let n = pick(have); if (have.length > 1 && n === this.last[key]) n = have[(have.indexOf(n) + 1) % have.length];
    this.last[key] = n;
    const src = c.createBufferSource(); src.buffer = this.buf[n];
    src.playbackRate.value = rate[0] + Math.random() * (rate[1] - rate[0]);
    const g = c.createGain(); g.gain.value = gain * (0.85 + Math.random() * 0.3);
    src.connect(g); g.connect(this.master);
    src.start(c.currentTime + delay);
    return true;
  }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
      this.load();
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
    if (this.playClip(name, r)) return;
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
      case 'clash': this.tone(1600 * r, 0.25, { type: 'triangle', gain: 0.1, f1: 1300 }); this.noise(0.1, { f0: 4500, f1: 1800, gain: 0.25 }); break;
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

  // Recorded versions (with a touch of synthesis underneath for punch). False = not loaded yet.
  playClip(name, r) {
    const S = ['swing1', 'swing2', 'swing3'];
    switch (name) {
      case 'swing': return this.clip(S, { gain: 0.42, rate: [0.95, 1.2] });
      case 'hit': if (!this.clip(['slice1', 'slice2'], { gain: 0.32, rate: [0.9, 1.1] })) return false;
        this.tone(105 * r, 0.12, { type: 'triangle', gain: 0.28, f1: 55 }); return true;
      case 'crit': if (!this.clip(['chop'], { gain: 0.6, rate: [0.85, 0.95] })) return false;
        this.clip(['slice1', 'slice2'], { gain: 0.3 }); this.tone(85, 0.2, { gain: 0.45, f1: 42 }); return true;
      case 'block': return this.clip(['clank1', 'clank2', 'clank3'], { gain: 0.45, rate: [1.0, 1.25] });
      case 'bonk': if (!this.clip(['chop'], { gain: 0.45, rate: [1.25, 1.45] })) return false; // weapon on bone
        this.clip(['latch'], { gain: 0.2, rate: [1.1, 1.3] }); return true;
      case 'clash': if (!this.clip(['clank1', 'clank2', 'clank3'], { gain: 0.42, rate: [1.15, 1.4] })) return false; // blade on blade (duels)
        this.clip(['slice1', 'slice2'], { gain: 0.22, rate: [1.0, 1.15] }); return true;
      case 'break': if (!this.clip(['chop'], { gain: 0.55, rate: [0.65, 0.8] })) return false;
        this.noise(0.3, { type: 'lowpass', f0: 1400, f1: 100, gain: 0.3 }); return true;
      case 'gold': return this.clip(['coins1', 'coins2'], { gain: 0.4, rate: [0.95, 1.1] });
      case 'pickup': return this.clip(['leather1', 'leather2', 'leather3'], { gain: 0.55 });
      case 'drop': return this.clip(['drop'], { gain: 0.5 });
      case 'chest': if (!this.clip(['creak1', 'creak2'], { gain: 0.45, rate: [0.8, 0.95] })) return false;
        this.clip(['latch'], { gain: 0.35, rate: [0.8, 0.9] }); return true;
      case 'cleave': if (!this.clip(['swing3'], { gain: 0.55, rate: [0.72, 0.82] })) return false;
        this.noise(0.4, { f0: 2600, f1: 300, q: 0.8, gain: 0.16, attack: 0.05 }); return true;
      case 'bash': if (!this.clip(['clank1', 'clank2', 'clank3'], { gain: 0.5, rate: [0.6, 0.72] })) return false;
        this.tone(80, 0.2, { gain: 0.5, f1: 40 }); this.noise(0.12, { type: 'lowpass', f0: 1200, f1: 100, gain: 0.35 }); return true;
      default: return false;
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
