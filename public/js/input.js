// Unified input: keyboard + mouse, Xbox-style controllers (Gamepad API) and on-screen touch controls.
// Produces a camera-relative move vector and named actions.

const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home'];
export const PAD_GLYPH = { attack: 'A', skill0: 'X', skill1: 'Y', skill2: 'B', skill3: 'RB', hp: 'LT', mp: 'RT', use: 'LB' };
export const KEY_GLYPH = { attack: 'LMB', skill0: '1', skill1: '2', skill2: '3', skill3: '4', hp: 'Q', mp: 'R', use: 'E' };

export class Input {
  constructor(canvas, handlers) {
    this.h = handlers;
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
    this.attackHeld = false;
    this.source = 'keyboard'; // keyboard | pad | touch
    this.camTurn = 0; this.camZoom = 0;
    this.enabled = true;
    this.touchMove = { x: 0, y: 0 };
    this.padMove = { x: 0, y: 0 };
    this.prevPad = {};
    this.bindKeyboard(canvas);
    setInterval(() => this.pollPad(), 16);
  }

  typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); }

  bindKeyboard(canvas) {
    addEventListener('keydown', (e) => {
      if (this.typing()) return;
      const k = e.key.toLowerCase();
      if (e.repeat && !['w', 'a', 's', 'd'].includes(k)) return;
      this.setSource('keyboard');
      this.keys.add(k);
      const map = { '1': 'skill0', '2': 'skill1', '3': 'skill2', '4': 'skill3', q: 'hp', r: 'mp', e: 'use', f: 'use', i: 'inventory', c: 'character', k: 'skills', tab: 'map', m: 'map', escape: 'menu', enter: 'chat', v: 'ptt', ' ': 'attack' };
      const act = map[k];
      if (act) {
        if (k === 'tab' || k === ' ') e.preventDefault();
        if (act === 'attack') this.attackHeld = true;
        this.h.onAction(act, true);
      }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === ' ') this.attackHeld = false;
      if (k === 'v') this.h.onAction('ptt', false);
    });
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; if (this.source !== 'touch') this.setSource('keyboard'); });
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.sourceCapabilities?.firesTouchEvents || this.source === 'touch') return;
      this.setSource('keyboard');
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 0) { this.attackHeld = true; this.h.onAction('attack', true); }
      if (e.button === 2) this.h.onAction('skill0', true);
      if (e.button === 1) { this.dragging = { x: e.clientX }; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.attackHeld = false; if (e.button === 1) this.dragging = null; });
    addEventListener('mousemove', (e) => { if (this.dragging) { this.h.onCamera((e.clientX - this.dragging.x) * 0.008, 0); this.dragging.x = e.clientX; } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.h.onCamera(0, Math.sign(e.deltaY) * 1.2); e.preventDefault(); }, { passive: false });
  }

  setSource(s) {
    if (this.source === s) return;
    this.source = s;
    this.h.onSource?.(s);
  }

  // ------------------------------------------------------------ touch
  bindTouch(root) {
    const zone = root.querySelector('#stick-zone'); const stick = root.querySelector('#stick'); const knob = stick.querySelector('i');
    let id = null; let ox = 0; let oy = 0;
    const R = 50;
    const home = () => { stick.style.left = ''; stick.style.top = ''; knob.style.transform = ''; };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId; zone.setPointerCapture(id);
      ox = e.clientX; oy = e.clientY;
      stick.style.left = `${ox}px`; stick.style.top = `${oy}px`;
      this.setSource('touch');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox; let dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.min(1, d / R);
      this.touchMove = d > 6 ? { x: (dx / Math.max(d, 1)) * m, y: (-dy / Math.max(d, 1)) * m } : { x: 0, y: 0 };
    });
    const end = (e) => { if (e.pointerId !== id) return; id = null; this.touchMove = { x: 0, y: 0 }; home(); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    // Two-finger twist on the right side would be nice; a simple swipe on empty screen rotates the camera.
    let swipe = null;
    // Swiping empty screen (the 3D view) turns the camera.
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') swipe = { id: e.pointerId, x: e.clientX }; });
    cv.addEventListener('pointermove', (e) => { if (swipe && e.pointerId === swipe.id) { this.h.onCamera((e.clientX - swipe.x) * 0.01, 0); swipe.x = e.clientX; } });
    const endSwipe = (e) => { if (swipe && e.pointerId === swipe.id) swipe = null; };
    cv.addEventListener('pointerup', endSwipe); cv.addEventListener('pointercancel', endSwipe);

    const hold = (el, act) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.setSource('touch');
        if (act === 'attack') this.attackHeld = true;
        this.h.onAction(act, true);
      });
      const up = () => { if (act === 'attack') this.attackHeld = false; };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
    };
    hold(root.querySelector('#t-attack'), 'attack');
    root.querySelectorAll('.tbtn.sk').forEach((b) => hold(b, `skill${b.dataset.skill}`));
    hold(root.querySelector('#t-hp'), 'hp');
    hold(root.querySelector('#t-mp'), 'mp');
    hold(root.querySelector('#t-use'), 'use');
  }

  // ------------------------------------------------------------ gamepad
  pollPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const pad = pads.sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!pad) { this.padMove = { x: 0, y: 0 }; return; }
    this.pad = pad;
    const st = {};
    BUTTONS.forEach((n, i) => { const b = pad.buttons[i]; st[n] = !!b && (b.pressed || b.value > 0.4); });
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    const mx = dz(lx); const my = dz(ly);
    this.padMove = { x: mx, y: -my };
    if (mx || my || Object.values(st).some(Boolean)) this.setSource('pad');
    if (this.source === 'pad') {
      if (dz(rx)) this.h.onCamera(dz(rx) * 0.045, 0);
      if (dz(ry)) this.h.onCamera(0, dz(ry) * 0.25);
    }
    const map = { a: 'attack', x: 'skill0', y: 'skill1', b: 'skill2', rb: 'skill3', lt: 'hp', rt: 'mp', lb: 'use', menu: 'menu', view: 'inventory', up: 'padUp', down: 'padDown', left: 'padLeft', right: 'padRight', rs: 'map' };
    for (const [btn, act] of Object.entries(map)) {
      if (st[btn] && !this.prevPad[btn]) this.h.onAction(act, true, 'pad');
      if (!st[btn] && this.prevPad[btn] && act === 'attack') this.padAttack = false;
    }
    if (st.a) this.padAttack = true;
    this.prevPad = st;
  }

  rumble(ms = 100, strong = 0.4, weak = 0.25) {
    try { this.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* unsupported */ }
    if (this.source === 'touch' && navigator.vibrate) try { navigator.vibrate(Math.min(ms, 40)); } catch { /* ignore */ }
  }

  // Camera-relative move vector: x = right, y = forward. Length 0..1.
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0; let y = 0;
    if (!this.typing()) {
      if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    }
    x += this.padMove.x + this.touchMove.x; y += this.padMove.y + this.touchMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  attacking() { return this.enabled && (this.attackHeld || this.padAttack); }
}
