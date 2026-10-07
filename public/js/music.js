// Procedural music: a slow chord pad, a plucked melody and sparse drums, generated live with
// Web Audio so there are no music files to download. Each area has its own scale and mood,
// and the drums pick up when a boss is near.

const THEMES = {
  // root (MIDI), scale steps, chord progression (scale degrees), tempo, melody density, drums
  town: { root: 55, scale: [0, 2, 4, 7, 9], prog: [0, 3, 4, 0], bpm: 88, notes: 0.55, drums: 0, bright: 1, wave: 'triangle' },
  crypt: { root: 50, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4], bpm: 66, notes: 0.3, drums: 0.5, bright: 0.45, wave: 'sine' },
  cavern: { root: 52, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6], bpm: 72, notes: 0.28, drums: 0.6, bright: 0.4, wave: 'sine' },
  infernal: { root: 48, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 5, 4], bpm: 80, notes: 0.35, drums: 0.8, bright: 0.55, wave: 'sawtooth' },
};
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export class Music {
  constructor() { this.ctx = null; this.vol = 0.5; this.theme = null; this.boss = false; this.timer = null; }

  attach(ctx) {
    if (this.ctx || !ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = this.vol * 0.55; this.out.connect(ctx.destination);
    // Cheap reverb: a generated decaying-noise impulse response.
    const len = ctx.sampleRate * 2.8; const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.45;
    this.verb.connect(this.wet); this.wet.connect(this.out);
    this.bus = ctx.createGain(); this.bus.connect(this.out); this.bus.connect(this.verb);
    if (this.pending) { const t = this.pending; this.pending = null; this.play(t); }
  }

  setVolume(v) {
    this.vol = v;
    if (this.out) this.out.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.1);
  }

  play(theme) {
    if (!THEMES[theme]) theme = 'crypt';
    if (!this.ctx) { this.pending = theme; return; }
    if (this.theme === theme && this.timer) return;
    this.theme = theme; this.t = THEMES[theme];
    this.beat = 0; this.next = this.ctx.currentTime + 0.2;
    this.stopPad();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 90);
  }

  setBoss(on) { this.boss = !!on; }

  stop() { clearInterval(this.timer); this.timer = null; this.theme = null; this.stopPad(); }

  // ------------------------------------------------------------ scheduling
  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running' || this.vol <= 0) { if (c) this.next = Math.max(this.next, c.currentTime + 0.1); return; }
    const T = this.t; const bpm = this.boss ? Math.max(T.bpm, 118) : T.bpm;
    const step = 60 / bpm / 2; // eighth notes
    while (this.next < c.currentTime + 0.35) {
      const b = this.beat;
      const bar = Math.floor(b / 8); const inBar = b % 8;
      const chordDeg = T.prog[bar % T.prog.length];
      if (inBar === 0 && bar % 2 === 0) this.pad(chordDeg, step * 16, this.next);
      // melody: random scale notes, more likely on strong beats, resolving toward chord tones
      const p = T.notes * (inBar % 2 === 0 ? 1.3 : 0.7) * (this.boss ? 1.3 : 1);
      if (Math.random() < p) {
        const pool = Math.random() < 0.6 ? [chordDeg, chordDeg + 2, chordDeg + 4] : [chordDeg + Math.floor(Math.random() * 7)];
        const deg = pool[Math.floor(Math.random() * pool.length)];
        this.pluck(this.note(deg, 12 + (Math.random() < 0.25 ? 12 : 0)), this.next, step * (Math.random() < 0.3 ? 3 : 1.6));
      }
      // drums
      const d = this.boss ? 1 : T.drums;
      if (d > 0) {
        if (inBar === 0 || (inBar === 4 && Math.random() < d)) this.kick(this.next, this.boss ? 1 : 0.7);
        if (this.boss && (inBar === 2 || inBar === 6)) this.snare(this.next);
        if (this.boss && inBar % 2 === 1 && Math.random() < 0.6) this.tick(this.next);
        if (!this.boss && inBar === 6 && Math.random() < d * 0.35) this.kick(this.next, 0.4);
      }
      this.next += step; this.beat++;
    }
  }

  note(deg, oct = 0) {
    const S = this.t.scale; const n = S.length;
    const o = Math.floor(deg / n); const i = ((deg % n) + n) % n;
    return this.t.root + S[i] + 12 * o + oct;
  }

  // ------------------------------------------------------------ voices
  pad(deg, dur, at) {
    const c = this.ctx; const T = this.t;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.09, at + dur * 0.25);
    g.gain.setValueAtTime(0.09, at + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 1.2);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
    f.frequency.setValueAtTime(300 + 900 * T.bright, at);
    f.frequency.linearRampToValueAtTime(500 + 1600 * T.bright, at + dur * 0.5);
    f.frequency.linearRampToValueAtTime(300 + 900 * T.bright, at + dur);
    f.connect(g); g.connect(this.bus);
    for (const [off, det] of [[0, -7], [0, 7], [this.t.scale.length >= 7 ? 4 : 3, 0], [-7, 0]]) {
      const o = c.createOscillator(); o.type = this.theme === 'town' ? 'triangle' : 'sawtooth';
      o.frequency.value = mtof(this.note(deg + off)); o.detune.value = det;
      o.connect(f); o.start(at); o.stop(at + dur + 1.4);
    }
  }

  pluck(midi, at, dur) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = this.t.wave === 'sawtooth' ? 'square' : 'triangle'; o.frequency.value = mtof(midi);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(midi) * 2.003;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2600 * (0.5 + this.t.bright), at); f.frequency.exponentialRampToValueAtTime(400, at + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.07, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(this.bus);
    o.start(at); o2.start(at); o.stop(at + dur + 0.05); o2.stop(at + dur + 0.05);
  }

  kick(at, v = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, at); o.frequency.exponentialRampToValueAtTime(38, at + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.32 * v, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    o.connect(g); g.connect(this.out); o.start(at); o.stop(at + 0.65);
  }

  snare(at) {
    const c = this.ctx; const len = c.sampleRate * 0.25;
    const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400;
    const g = c.createGain(); g.gain.value = 0.16;
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(at);
  }

  tick(at) {
    const c = this.ctx; const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 5200;
    const g = c.createGain(); g.gain.setValueAtTime(0.02, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    o.connect(g); g.connect(this.out); o.start(at); o.stop(at + 0.05);
  }

  stopPad() { /* voices end on their own envelopes */ }
}
