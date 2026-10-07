// Unified input: keyboard + mouse, Xbox-style controllers (Gamepad API) and on-screen touch controls.
// Produces a camera-relative move vector and named actions.

const BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home'];
export const PAD_GLYPH = { attack: 'A', skill0: 'X', skill1: 'Y', skill2: 'B', skill3: 'RB', hp: 'LT', mp: 'RT', use: 'LB' };
export const KEY_GLYPH = { attack: 'Space', skill0: '1', skill1: '2', skill2: '3', skill3: '4', hp: 'Q', mp: 'R', use: 'E' };

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
    this.opts = { invertX: false, invertY: false };
    this.navNext = 0; this.navDir = null;
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
    addEventListener('blur', () => { this.keys.clear(); this.attackHeld = false; this.lmb = null; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; if (this.source !== 'touch') this.setSource('keyboard'); });
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    // The mouse never attacks: it's free for menus, aiming and the camera.
    // Hold either button and drag to turn the camera (and tilt it with up/down).
    // The right button captures the cursor while held; the left button just drags.
    canvas.addEventListener('mousedown', (e) => {
      if (e.sourceCapabilities?.firesTouchEvents || this.source === 'touch') return;
      this.setSource('keyboard');
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 0) this.lmb = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.rmb = { t: performance.now(), moved: 0 };
        try { canvas.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => canvas.requestPointerLock?.()); } catch { /* not supported */ }
      }
      if (e.button === 1) { this.dragging = { x: e.clientX }; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.lmb = null; document.body.classList.remove('cam-drag'); }
      if (e.button === 1) this.dragging = null;
      if (e.button === 2 && this.rmb) {
        this.rmb = null;
        if (document.pointerLockElement) document.exitPointerLock?.();
      }
    });
    addEventListener('mousemove', (e) => {
      if (this.dragging) { this.h.onCamera(-(e.clientX - this.dragging.x) * 0.008, 0); this.dragging.x = e.clientX; }
      if (this.lmb) {
        const dx = e.clientX - this.lmb.x; const dy = e.clientY - this.lmb.y;
        this.lmb.x = e.clientX; this.lmb.y = e.clientY;
        document.body.classList.add('cam-drag');
        this.h.onCamera(-dx * 0.006, 0, dy * 0.004 * (this.opts.invertY ? -1 : 1));
      }
      if (this.rmb) {
        let mx = e.movementX || 0; let my = e.movementY || 0;
        // Some browsers report a big jump when the mouse is captured; ignore those spikes.
        if (Math.abs(mx) > 150 || Math.abs(my) > 150) { mx = 0; my = 0; }
        this.rmb.moved += Math.abs(mx) + Math.abs(my);
        this.h.onCamera(-mx * 0.006, 0, my * 0.004 * (this.opts.invertY ? -1 : 1));
      }
    });
    // If the browser drops the capture (Esc, alt-tab), stop turning.
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.rmb) this.rmb = null;
      // A quick right-click can finish before the browser grants the capture: let go straight away.
      if (document.pointerLockElement && !this.rmb) document.exitPointerLock?.();
    });
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
    const home = () => { knob.style.transform = ''; stick.classList.remove('active'); };
    // The stick stays put: drags are measured from its fixed center wherever the thumb lands in the zone.
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId; zone.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      ox = r.left + r.width / 2; oy = r.top + r.height / 2;
      stick.classList.add('active');
      this.setSource('touch');
      e.preventDefault();
      zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, clientX: e.clientX, clientY: e.clientY }));
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
    this.padMove = this.h.menuOpen?.() ? { x: 0, y: 0 } : { x: mx, y: -my };
    if (mx || my || Object.values(st).some(Boolean)) this.setSource('pad');
    const menu = !!this.h.menuOpen?.();
    // Right stick: X turns the camera, Y tilts it (either can be inverted in the menu).
    if (this.source === 'pad' && !menu) {
      const cx = dz(rx) * (this.opts.invertX ? -1 : 1); const cy = dz(ry) * (this.opts.invertY ? -1 : 1);
      if (cx || cy) this.h.onCamera(cx * 0.045, 0, cy * 0.012);
    }
    // In menus the right stick scrolls the open window (inventory, shop, menu, hero list …).
    if (menu) {
      const sy = dz(ry);
      if (sy) { this.setSource('pad'); this.h.onMenuScroll?.(Math.sign(sy) * sy * sy * 22 + sy * 4); }
    }
    // Menu navigation: D-pad or left stick, with auto-repeat while held.
    const now = performance.now();
    let dir = st.up ? 'Up' : st.down ? 'Down' : st.left ? 'Left' : st.right ? 'Right' : null;
    if (!dir && menu) {
      if (Math.abs(ly) > 0.55 && Math.abs(ly) >= Math.abs(lx)) dir = ly < 0 ? 'Up' : 'Down';
      else if (Math.abs(lx) > 0.55) dir = lx < 0 ? 'Left' : 'Right';
    }
    if (dir !== this.navDir) { this.navDir = dir; if (dir) { this.h.onAction(`pad${dir}`, true, 'pad'); this.navNext = now + 380; } }
    else if (dir && now >= this.navNext) { this.h.onAction(`pad${dir}`, true, 'pad'); this.navNext = now + 110; }
    const map = { a: 'attack', x: 'skill0', y: 'skill1', b: 'skill2', rb: 'skill3', lt: 'hp', rt: 'mp', lb: 'use', menu: 'menu', view: 'inventory', rs: 'map' };
    for (const [btn, act] of Object.entries(map)) {
      if (st[btn] && !this.prevPad[btn]) this.h.onAction(act, true, 'pad');
      if (!st[btn] && this.prevPad[btn] && act === 'attack') this.padAttack = false;
    }
    if (st.a && !this.h.menuOpen?.()) this.padAttack = true;
    if (!st.a) this.padAttack = false;
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

  holdAttack(on) { this.attackHeld = !!on; if (on) this.h.onAction('attack', true); }
  attacking() { return this.enabled && (this.attackHeld || this.padAttack); }
}
