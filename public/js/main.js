// Entry point: sign-in, hero select, and the main loop.
import { io } from '/socket.io/socket.io.esm.min.js';
import { World } from './render/world.js';
import { loadModelManifest } from './render/models.js';
import { Input } from './input.js';
import { UI, esc, $, $$ } from './ui.js';
import { Sfx } from './audio.js';
import { Voice } from './voice.js';
import { Game } from './game.js';
import { generateTown } from '/shared/map.js';
import { CLASSES, newCharacter } from '/shared/rules.js';

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(`sc_${k}`); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`sc_${k}`, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(`sc_${k}`); } catch { /* ignore */ } },
};

const coarse = matchMedia('(pointer: coarse)').matches;
const world = new World($('#scene'), $('#labels'));
world.setQuality(store.get('quality', coarse ? 'low' : 'high'));
world.showLootLabels = store.get('labels', '1') === '1';
const sfx = new Sfx();
sfx.setVolume(Number(store.get('sfx', '0.7')));
let socket = null; let game = null; let voice = null; let config = {};
let chars = []; let selected = null; let classes = {};

const ui = new UI({
  inv: (a) => socket.emit('inv', a, (r) => { if (!r?.ok) { ui.msg(r?.error || 'Could not do that', 'warn'); sfx.play('error'); } else sfx.play('click'); }),
  interact: () => game?.interact(),
  pickup: (id) => game?.pickup(id),
  skill: (i) => game?.useSkill(i),
  potion: (k) => game?.potion(k),
  gate: (floor) => socket.emit('gate', { floor }, (r) => { if (!r?.ok) ui.msg(r?.error, 'warn'); }),
  chat: (text) => socket.emit('chat', { text }),
  leave: () => leaveGame(),
  nearShop: () => game?.nearShop(),
  panelsChanged: (open) => { if (open) sfx.play('click'); },
});

const input = new Input(world.renderer.domElement, {
  onAction: (name, down, src) => {
    sfx.unlock(); voice?.unlock();
    if (name === 'ptt' && !down) { voice?.pushToTalk(false); return; }
    if (game) game.action(name, down, src);
  },
  onCamera: (dyaw, dzoom) => { world.yaw += dyaw; world.targetDist = Math.max(9, Math.min(24, world.targetDist + dzoom)); },
  onSource: (s) => { ui.setSource(s); ui.controlsHelp(s); if (s === 'touch' && !touchOn) setTouch(true); },
});
input.bindTouch($('#touch'));
let touchOn = store.get('touch', coarse ? '1' : '0') === '1';
function setTouch(on) { touchOn = on; ui.setTouch(on); $('#touch-toggle').checked = on; store.set('touch', on ? '1' : '0'); }
setTouch(touchOn);
ui.setSource(coarse ? 'touch' : 'keyboard'); ui.controlsHelp('keyboard');

// Settings
$('#quality-select').value = world.quality;
$('#quality-select').addEventListener('change', (e) => { store.set('quality', e.target.value); ui.msg('Graphics change applies on the next area', 'info'); world.setQuality(e.target.value); });
$('#sfx-vol').value = sfx.vol;
$('#sfx-vol').addEventListener('input', (e) => { sfx.setVolume(Number(e.target.value)); store.set('sfx', e.target.value); });
$('#touch-toggle').addEventListener('change', (e) => setTouch(e.target.checked));
$('#labels-toggle').checked = world.showLootLabels;
$('#labels-toggle').addEventListener('change', (e) => { world.showLootLabels = e.target.checked; store.set('labels', e.target.checked ? '1' : '0'); });
addEventListener('pointerdown', () => { sfx.unlock(); voice?.unlock(); }, { once: false });

// ------------------------------------------------------------ screens
const show = (id) => { for (const s of ['auth', 'select', 'hud']) $(`#${s}`).classList.toggle('hidden', s !== id); };

async function boot() {
  try { config = await (await fetch('/api/config')).json(); } catch { config = {}; }
  await loadModelManifest();
  // Town backdrop behind the menus
  const town = generateTown();
  world.loadZone(town);
  world.focus.set(town.start.x, 0, town.start.y - 6);
  world.targetDist = 18;
  setTimeout(() => $('#loading').classList.add('fade'), 150);
  const params = new URLSearchParams(location.search);
  if (params.get('party')) $('#join-code').value = params.get('party').toUpperCase().slice(0, 5);
  if (store.get('token')) connect(); else showAuth();
}

function showAuth() {
  show('auth');
  if (config.googleClientId) initGoogle();
}

let authMode = 'login';
$$('#auth .tab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.auth;
  $$('#auth .tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#auth-submit').textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-pass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  sfx.unlock();
  const body = { username: $('#auth-user').value.trim(), password: $('#auth-pass').value };
  $('#auth-submit').disabled = true;
  try {
    const r = await (await fetch(authMode === 'login' ? '/api/login' : '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!r.ok) throw new Error(r.error);
    store.set('token', r.token);
    connect();
  } catch (err) { $('#auth-error').textContent = err.message || 'Could not sign in'; }
  finally { $('#auth-submit').disabled = false; }
});

function initGoogle() {
  $('#google-wrap').classList.remove('hidden');
  const render = () => {
    window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogle });
    window.google.accounts.id.renderButton($('#google-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
  };
  if (window.google?.accounts?.id) return render();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = render;
  s.onerror = () => $('#google-wrap').classList.add('hidden');
  document.head.appendChild(s);
}

async function onGoogle(resp) {
  try {
    const r = await (await fetch('/api/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) })).json();
    if (!r.ok) throw new Error(r.error);
    store.set('token', r.token);
    connect();
  } catch (err) { $('#auth-error').textContent = err.message; }
}

function connect() {
  socket?.disconnect();
  socket = io({ auth: { token: store.get('token') }, transports: ['websocket', 'polling'] });
  socket.on('connect_error', (err) => {
    if (err.message === 'auth') { store.del('token'); socket.disconnect(); showAuth(); }
    else { $('#select-error').textContent = 'Can\'t reach the server — retrying…'; }
  });
  socket.on('connect', () => { $('#select-error').textContent = ''; if (!game) loadChars(); });
  socket.on('kicked', (d) => { alert(d.reason); });
  socket.on('disconnect', () => {
    if (game) { ui.msg('Connection lost — reconnecting…', 'warn'); }
  });
  socket.io.on('reconnect', () => { if (game) { endGame(); loadChars(); $('#select-error').textContent = 'You were disconnected. Your hero was saved.'; } });
  voice = new Voice(socket, { onLevel: (pid, lvl) => ui.talking(pid, lvl) });
  voice.setPtt(store.get('ptt', '0') === '1');
}

function loadChars() {
  socket.emit('chars', (r) => {
    if (!r?.ok) { $('#select-error').textContent = r?.error || 'Error'; return; }
    chars = r.chars; classes = r.classes;
    $('#who-name').textContent = `Signed in as ${r.username}`;
    show('select');
    renderHeroes();
  });
}

function renderHeroes() {
  const list = $('#hero-list');
  if (!chars.length) list.innerHTML = '<div class="empty">No heroes yet. Create one to begin.</div>';
  else list.innerHTML = chars.map((c) => `<button class="hero ${selected === c.id ? 'active' : ''}" data-id="${c.id}" type="button"><span class="portrait">⚔</span><span class="meta"><b>${esc(c.name)}</b><small>Level ${c.level} ${esc(classes[c.cls]?.name || c.cls)} · deepest floor ${c.maxFloor || 1}</small></span></button>`).join('');
  $$('#hero-list .hero').forEach((b) => b.addEventListener('click', () => selectHero(Number(b.dataset.id))));
  const pick = chars.find((c) => c.id === selected) || chars[0];
  if (pick) selectHero(pick.id);
  if (!chars.length) { $('#play-buttons').classList.add('hidden'); $('#play-title').textContent = 'Choose a hero'; $('#play-info').textContent = ''; }
}

let preview = null;
function selectHero(id) {
  selected = id;
  const c = chars.find((x) => x.id === id);
  $$('#hero-list .hero').forEach((b) => b.classList.toggle('active', Number(b.dataset.id) === id));
  $('#play-title').textContent = c.name;
  $('#play-info').innerHTML = `Level <b>${c.level}</b> ${esc(classes[c.cls]?.name || c.cls)}. Deepest floor reached: <b>${c.maxFloor || 1}</b>.<br>Play alone, host a party (share the code with up to 3 friends), or join a friend's code.`;
  $('#play-buttons').classList.remove('hidden');
  // Hero standing in the village square behind the menu
  if (preview) world.remove(preview);
  const town = generateTown();
  preview = 'preview';
  world.add({ id: preview, k: 'p', pid: 'x', name: c.name, cls: c.cls, look: c.look, x: town.start.x, y: town.start.y - 6, rot: 0 }, { me: true });
}

$('#new-hero-btn').addEventListener('click', () => {
  const keys = Object.keys(classes);
  const locked = [['Berserker', 'Twin axes and fury. Coming soon.'], ['Alchemist', 'Bombs and potions. Coming soon.'], ['Druid', 'Nature magic and shapeshifting. Coming soon.']];
  $('#class-list').innerHTML = keys.map((k, i) => `<button class="class-opt ${i === 0 ? 'active' : ''}" data-cls="${k}" type="button"><b>${esc(classes[k].name)}</b><p>${esc(classes[k].blurb)}</p></button>`).join('')
    + locked.map(([n, b]) => `<div class="class-opt locked"><b>${n}</b><p>${b}</p></div>`).join('');
  $$('#class-list [data-cls]').forEach((b) => b.addEventListener('click', () => $$('#class-list [data-cls]').forEach((x) => x.classList.toggle('active', x === b))));
  $('#create-error').textContent = '';
  $('#hero-name').value = '';
  $('#create-modal').classList.remove('hidden');
  $('#hero-name').focus();
});
$('#create-modal [data-close]').addEventListener('click', () => $('#create-modal').classList.add('hidden'));
$('#create-hero-btn').addEventListener('click', () => {
  const cls = $('#class-list .active')?.dataset.cls || 'knight';
  socket.emit('createChar', { name: $('#hero-name').value, cls }, (r) => {
    if (!r?.ok) { $('#create-error').textContent = r?.error; return; }
    $('#create-modal').classList.add('hidden');
    selected = r.id;
    loadChars();
  });
});
$('#hero-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#create-hero-btn').click(); });
$('#delete-hero-btn').addEventListener('click', () => {
  const c = chars.find((x) => x.id === selected);
  if (!c || !confirm(`Delete ${c.name} forever? Their items and progress will be lost.`)) return;
  socket.emit('deleteChar', { id: c.id }, (r) => { if (!r?.ok) $('#select-error').textContent = r?.error; selected = null; loadChars(); });
});
$('#signout-btn').addEventListener('click', () => { store.del('token'); socket?.disconnect(); socket = null; try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ } showAuth(); });

$('#solo-btn').addEventListener('click', () => play('solo'));
$('#host-btn').addEventListener('click', () => play('host'));
$('#join-btn').addEventListener('click', () => play('join', $('#join-code').value));
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') play('join', e.target.value); });

// ------------------------------------------------------------ phones: full screen + landscape
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!fsElement()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
    await screen.orientation?.lock?.('landscape');
  } catch { /* not allowed here (e.g. iPhone Safari) */ }
  checkOrientation();
}
function exitFullscreen() { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* ignore */ } }
function checkOrientation() {
  const portrait = innerHeight > innerWidth;
  $('#rotate').classList.toggle('hidden', !(coarse && game && portrait));
  $('#fs-btn').classList.toggle('hidden', isIOS && !document.documentElement.webkitRequestFullscreen && !document.documentElement.requestFullscreen);
}
addEventListener('resize', checkOrientation);
screen.orientation?.addEventListener?.('change', checkOrientation);
document.addEventListener('fullscreenchange', checkOrientation);
$('#fs-btn').addEventListener('click', () => (fsElement() ? exitFullscreen() : enterFullscreen()));
$('#rotate-fs').addEventListener('click', () => enterFullscreen());
$('#ios-tip-x').addEventListener('click', () => { $('#ios-tip').classList.add('hidden'); store.set('iosTip', '1'); });

function play(mode, code) {
  if (!selected) return;
  if (coarse) enterFullscreen(); // must happen in the tap that starts the game
  if (coarse && isIOS && !standalone && store.get('iosTip') !== '1') $('#ios-tip').classList.remove('hidden');
  sfx.unlock();
  $('#select-error').textContent = '';
  $('#fade').classList.add('on');
  socket.emit('play', { charId: selected, mode, code }, (r) => {
    if (!r?.ok) { $('#fade').classList.remove('on'); $('#select-error').textContent = r?.error || 'Could not start'; return; }
    if (preview) { world.remove(preview); preview = null; }
    voice.setMyPid(r.pid);
    game = new Game({ socket, world, input, ui, sfx, voice, me: r });
    show('hud');
    ui.setTouch(touchOn);
    world.targetDist = 15;
    if (!r.solo) ui.msg(`Party code: ${r.code} — share it so friends can join`, 'good');
    checkOrientation();
  });
}

function endGame() {
  game?.destroy(); game = null;
  checkOrientation();
  voice?.closeAll();
  ui.closePanels();
  $('#mic-btn').classList.remove('on'); $('#voice-toggle').checked = false;
}

function leaveGame() {
  socket.emit('leaveGame', () => {
    endGame();
    const town = generateTown();
    world.loadZone(town);
    world.focus.set(town.start.x, 0, town.start.y - 6);
    world.targetDist = 18;
    selected = selected || null;
    loadChars();
    if (selected) setTimeout(() => selectHero(selected), 50);
  });
}

// Voice chat
async function toggleMic(on) {
  try {
    if (on) { await voice.start(); ui.msg('Microphone on', 'good'); } else { voice.stop(); }
  } catch (e) { ui.msg(e.message || 'Microphone blocked', 'warn'); on = false; }
  $('#mic-btn').classList.toggle('on', on); $('#voice-toggle').checked = on;
}
$('#mic-btn').addEventListener('click', () => toggleMic(!voice.micOn));
$('#voice-toggle').addEventListener('change', (e) => toggleMic(e.target.checked));
$('#ptt-toggle').checked = store.get('ptt', '0') === '1';
$('#ptt-toggle').addEventListener('change', (e) => { voice?.setPtt(e.target.checked); store.set('ptt', e.target.checked ? '1' : '0'); });

// ------------------------------------------------------------ loop
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (game?.me) {
    game.update(dt);
    world.render(dt, game.me.x, game.me.y);
  } else {
    world.yaw += dt * 0.06;
    world.render(dt, world.focus.x, world.focus.z);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();
window.__sc = { world, get game() { return game; }, get socket() { return socket; } };
