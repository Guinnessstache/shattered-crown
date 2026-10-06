// Party voice chat: a WebRTC audio mesh between party members (adapted from High Roller Hold'em's
// MediaManager, audio only). Signaling goes through the game socket; "perfect negotiation" lets
// either side add the microphone at any time.
export class Voice {
  constructor(socket, opts = {}) {
    const { onLevel } = opts;
    this.socket = socket;
    this.myPid = null;
    this.peers = new Map();
    this.local = null;
    this.micOn = false;
    this.ptt = false; this.pttDown = false;
    // Chosen devices ('' = system default), mic gain (1 = 100%) and other players' voice volume.
    this.devices = { input: opts.input || '', output: opts.output || '' };
    this.micGain = opts.micGain ?? 1;
    this.voiceVol = opts.voiceVol ?? 1;
    this.onLevel = onLevel;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.host = document.createElement('div'); this.host.style.display = 'none'; document.body.appendChild(this.host);
    fetch('/api/ice').then((r) => r.json()).then((j) => { if (j.iceServers?.length) this.iceServers = j.iceServers; }).catch(() => {});
    socket.on('rtc', ({ from, data }) => this.onSignal(from, data));
    socket.on('peerLeft', ({ pid }) => this.closePeer(pid));
    this.timer = setInterval(() => this.levels(), 120);
  }

  setMyPid(pid) { this.myPid = pid; }

  ctx() {
    if (!this.audioCtx) { try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* none */ } }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  sync(members) {
    const want = new Set(members.filter((m) => m.pid !== this.myPid).map((m) => m.pid));
    for (const pid of want) if (!this.peers.has(pid)) this.createPeer(pid);
    for (const pid of [...this.peers.keys()]) if (!want.has(pid)) this.closePeer(pid);
  }

  createPeer(pid) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pid, pc, polite: Number(this.myPid) < Number(pid), makingOffer: false, ignoreOffer: false, audio: null, analyser: null };
    this.peers.set(pid, peer);
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); this.send(pid, { description: pc.localDescription }); }
      catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send(pid, { candidate }); };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce?.(); };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (!peer.audio) { peer.audio = document.createElement('audio'); peer.audio.autoplay = true; this.host.appendChild(peer.audio); }
      peer.audio.srcObject = stream;
      peer.audio.volume = this.voiceVol;
      this.applySink(peer.audio);
      peer.audio.play().catch(() => {});
      this.attach(peer, stream);
    };
    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    return peer;
  }

  send(to, data) { this.socket.emit('rtc', { to, data }); }

  async onSignal(from, data) {
    const peer = this.peers.get(from) || this.createPeer(from);
    const pc = peer.pc;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') { await pc.setLocalDescription(); this.send(from, { description: pc.localDescription }); }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.warn('signal', e); }
  }

  closePeer(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    try { p.pc.close(); } catch { /* ignore */ }
    p.audio?.remove();
    this.peers.delete(pid);
  }

  attach(target, stream) {
    const ctx = this.ctx();
    if (!ctx || !stream.getAudioTracks().length) return;
    try {
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      target.analyser = an; target.buf = new Uint8Array(an.fftSize);
    } catch { /* ignore */ }
  }

  levels() {
    const measure = (t) => {
      if (!t?.analyser) return 0;
      t.analyser.getByteTimeDomainData(t.buf);
      let s = 0; for (const v of t.buf) { const x = (v - 128) / 128; s += x * x; }
      return Math.min(1, Math.sqrt(s / t.buf.length) * 6);
    };
    for (const p of this.peers.values()) this.onLevel?.(p.pid, measure(p));
    if (this.meter) this.onLevel?.(this.myPid, this.transmitting() ? measure(this.meter) : 0);
  }

  transmitting() { return this.micOn && (!this.ptt || this.pttDown); }
  applyGate() { const t = this.local?.getAudioTracks()[0]; if (t) t.enabled = this.transmitting(); }

  audioConstraints(id = this.devices.input) {
    const c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (id) c.deviceId = { exact: id };
    return c;
  }

  // The mic runs through a gain node, so the volume slider changes what friends hear
  // without renegotiating the call. Switching microphones swaps only the source.
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs HTTPS (or localhost).');
    let raw;
    try { raw = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false }); }
    catch { raw = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints(''), video: false }); } // saved mic unplugged
    const ctx = this.ctx();
    this.raw = raw;
    this.srcNode = ctx.createMediaStreamSource(raw);
    this.gainNode = ctx.createGain(); this.gainNode.gain.value = this.micGain;
    this.dest = ctx.createMediaStreamDestination();
    this.srcNode.connect(this.gainNode); this.gainNode.connect(this.dest);
    const an = ctx.createAnalyser(); an.fftSize = 512; this.gainNode.connect(an);
    this.meter = { analyser: an, buf: new Uint8Array(an.fftSize) };
    const stream = this.dest.stream;
    this.local = stream; this.micOn = true;
    for (const p of this.peers.values()) for (const t of stream.getTracks()) p.pc.addTrack(t, stream);
    this.applyGate();
    this.socket.emit('media', { mic: true });
  }

  async setInput(id) {
    this.devices.input = id || '';
    if (!this.raw) return; // used next time the mic starts
    const fresh = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false });
    this.srcNode.disconnect();
    this.raw.getTracks().forEach((t) => t.stop());
    this.raw = fresh;
    this.srcNode = this.ctx().createMediaStreamSource(fresh);
    this.srcNode.connect(this.gainNode);
  }

  setOutput(id) { this.devices.output = id || ''; for (const p of this.peers.values()) this.applySink(p.audio); }
  applySink(el) { if (el?.setSinkId) el.setSinkId(this.devices.output || '').catch(() => {}); }
  setMicGain(v) { this.micGain = v; if (this.gainNode) this.gainNode.gain.value = v; }
  setVoiceVolume(v) { this.voiceVol = v; for (const p of this.peers.values()) if (p.audio) p.audio.volume = v; }
  canPickOutput() { return 'setSinkId' in HTMLMediaElement.prototype; }

  /** Microphones and speakers. Names stay blank until the page has microphone permission. */
  async listDevices() {
    const all = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) || [];
    const pick = (kind, word) => all.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${word} ${i + 1}` }));
    return { input: pick('audioinput', 'Microphone'), output: pick('audiooutput', 'Speakers'), labelled: all.some((d) => d.label) };
  }

  // Level of my own (gained) mic, 0..1, for the settings meter.
  myLevel() {
    const t = this.meter; if (!t?.analyser) return 0;
    t.analyser.getByteTimeDomainData(t.buf);
    let s = 0; for (const v of t.buf) { const x = (v - 128) / 128; s += x * x; }
    return Math.min(1, Math.sqrt(s / t.buf.length) * 6);
  }

  stop() {
    if (!this.local) return;
    for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track && this.local.getTracks().includes(s.track)) { try { p.pc.removeTrack(s); } catch { /* ignore */ } }
    this.local.getTracks().forEach((t) => t.stop());
    this.raw?.getTracks().forEach((t) => t.stop());
    try { this.srcNode?.disconnect(); this.gainNode?.disconnect(); } catch { /* ignore */ }
    this.local = null; this.raw = null; this.meter = null; this.micOn = false;
    this.socket.emit('media', { mic: false });
  }

  setPtt(on) { this.ptt = on; this.applyGate(); }
  pushToTalk(down) { this.pttDown = down; this.applyGate(); }
  unlock() { this.ctx(); for (const p of this.peers.values()) p.audio?.play().catch(() => {}); }
  closeAll() { for (const pid of [...this.peers.keys()]) this.closePeer(pid); this.stop(); }
}
