// Party voice chat: a WebRTC audio mesh between party members (adapted from High Roller Hold'em's
// MediaManager, audio only). Signaling goes through the game socket; "perfect negotiation" lets
// either side add the microphone at any time.
export class Voice {
  constructor(socket, { onLevel } = {}) {
    this.socket = socket;
    this.myPid = null;
    this.peers = new Map();
    this.local = null;
    this.micOn = false;
    this.ptt = false; this.pttDown = false;
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

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice chat needs HTTPS (or localhost).');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.local = stream; this.micOn = true;
    this.meter = {}; this.attach(this.meter, stream);
    for (const p of this.peers.values()) for (const t of stream.getTracks()) p.pc.addTrack(t, stream);
    this.applyGate();
    this.socket.emit('media', { mic: true });
  }

  stop() {
    if (!this.local) return;
    for (const p of this.peers.values()) for (const s of p.pc.getSenders()) if (s.track && this.local.getTracks().includes(s.track)) { try { p.pc.removeTrack(s); } catch { /* ignore */ } }
    this.local.getTracks().forEach((t) => t.stop());
    this.local = null; this.meter = null; this.micOn = false;
    this.socket.emit('media', { mic: false });
  }

  setPtt(on) { this.ptt = on; this.applyGate(); }
  pushToTalk(down) { this.pttDown = down; this.applyGate(); }
  unlock() { this.ctx(); for (const p of this.peers.values()) p.audio?.play().catch(() => {}); }
  closeAll() { for (const pid of [...this.peers.keys()]) this.closePeer(pid); this.stop(); }
}
