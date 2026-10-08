// Entry point: sign-in, hero select, and the main loop.
import { GroupFinder } from './groups.js';
import { io } from '/socket.io/socket.io.esm.min.js';
import { World } from './render/world.js';
import * as Models from './render/models.js';
const { loadModelManifest, skinnedHeroes } = Models;
import { loadBakedTextures } from './render/textures.js';
import { Input } from './input.js';
import { UI, esc, $, $$ } from './ui.js';
import { Sfx } from './audio.js';
import { Music } from './music.js';
import { Voice } from './voice.js';
import { Game } from './game.js';
import { AdminConsole } from './admin.js';
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
const music = new Music();
music.setVolume(Number(store.get('music', '0.5')));
music.play('town');
const unlockAudio = () => { sfx.unlock(); music.attach(sfx.ctx); };
let socket = null; let game = null; let voice = null; let config = {};
let chars = []; let selected = null; let classes = {};

const ui = new UI({
  inv: (a) => socket.emit('inv', a, (r) => { if (!r?.ok) { ui.msg(r?.error || 'Could not do that', 'warn'); sfx.play('error'); } else sfx.play('click'); }),
  interact: () => game?.interact(),
  pickup: (id) => game?.pickup(id),
  duel: (d) => socket.emit('duel', d, (r) => { if (!r?.ok) { ui.msg(r?.error || 'Could not do that', 'warn'); sfx.play('error'); } }),
  holdAttack: (on) => { unlockAudio(); input.holdAttack(on && !!game); },
  skill: (i) => game?.useSkill(i),
  potion: (k) => game?.potion(k),
  gate: (floor) => socket.emit('gate', { floor }, (r) => { if (!r?.ok) ui.msg(r?.error, 'warn'); }),
  chat: (text) => {
    if (/^\/(console|admin)\b/i.test(text)) { admin.open(); return; }
    socket.emit('chat', { text });
  },
  sfx: (n) => sfx.play(n),
  ah: (d) => new Promise((res) => socket.emit('ah', d, (r) => res(r || { error: 'No reply from server' }))),
  bank: (d) => new Promise((res) => socket.emit('bank', d, (r) => res(r || { error: 'No reply from server' }))),
  mail: (d) => new Promise((res) => socket.emit('mail', d, (r) => res(r || { error: 'No reply from server' }))),
  vkb: (el) => openVkb(el),
  listParty: (d) => socket.emit('listParty', d, (r) => { if (!r?.ok) { ui.msg(r?.error || 'Could not change that', 'warn'); sfx.play('error'); } }),
  leave: () => leaveGame(),
  nearShop: () => game?.nearShop(),
  panelsChanged: (open) => { if (open) { sfx.play('click'); if (!$('#menu-panel').classList.contains('hidden')) fillDevices(); } },
});

const input = new Input(world.renderer.domElement, {
  onAction: (name, down, src) => {
    unlockAudio(); voice?.unlock();
    if (name === 'ptt' && !down) { voice?.pushToTalk(false); return; }
    // On-screen keyboard open over a game window (typing a letter with a controller).
    if (game && vkbOpen()) { if (down && src === 'pad') { ui.navRoot = $('#vkb'); try { vkbPad(name); } finally { ui.navRoot = null; } } return; }
    if (game) game.action(name, down, src);
    else if (down && src === 'pad') titlePad(name);
  },
  onCamera: (dyaw, dzoom, dpitch = 0) => { world.yaw += dyaw; world.targetDist = Math.max(9, Math.min(24, world.targetDist + dzoom)); world.pitch = Math.max(0.5, Math.min(1.3, world.pitch + dpitch)); },
  menuOpen: () => !game || ui.anyOpen() || vkbOpen(),
  onMenuScroll: (dy) => ui.padScroll(dy, game && ui.anyOpen() ? ui.openPanelEl() : titleRoot()),
  onSource: (s) => { ui.setSource(s); ui.controlsHelp(s); if (s === 'touch' && !touchOn) setTouch(true); if (s === 'pad' && !game) setTimeout(() => focusTitle(), 0); },
});
const admin = new AdminConsole({ ui, socket: () => socket });
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
$('#music-vol').value = music.vol;
$('#music-vol').addEventListener('input', (e) => { music.setVolume(Number(e.target.value)); store.set('music', e.target.value); });
$('#touch-toggle').addEventListener('change', (e) => setTouch(e.target.checked));
for (const k of ['invertX', 'invertY']) {
  const box = $(`#${k === 'invertX' ? 'invx' : 'invy'}-toggle`);
  input.opts[k] = store.get(k, '0') === '1'; box.checked = input.opts[k];
  box.addEventListener('change', (e) => { input.opts[k] = e.target.checked; store.set(k, e.target.checked ? '1' : '0'); });
}
$('#labels-toggle').checked = world.showLootLabels;
$('#labels-toggle').addEventListener('change', (e) => { world.showLootLabels = e.target.checked; store.set('labels', e.target.checked ? '1' : '0'); });
skinnedHeroes.enabled = store.get('mocap', '1') === '1';
$('#mocap-toggle').checked = skinnedHeroes.enabled;
$('#mocap-toggle').addEventListener('change', (e) => { skinnedHeroes.enabled = e.target.checked; store.set('mocap', e.target.checked ? '1' : '0'); ui.msg('Applies on the next area', 'info'); });
addEventListener('pointerdown', () => { unlockAudio(); voice?.unlock(); }, { once: false });
addEventListener('keydown', () => unlockAudio());

// ------------------------------------------------------------ screens
const show = (id) => { for (const s of ['auth', 'select', 'hud']) $(`#${s}`).classList.toggle('hidden', s !== id); };

async function boot() {
  try { config = await (await fetch('/api/config')).json(); } catch { config = {}; }
  await Promise.all([loadModelManifest(), loadBakedTextures()]);
  // Swap the select-screen hero for its animated model once that finishes loading.
  Models.heroModelsReady.then(() => { if (!game && preview && selected) selectHero(selected); });
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
    else if (err.message === 'banned') { store.del('token'); socket.disconnect(); showAuth(); $('#auth-error').textContent = 'This account has been banned.'; }
    else { $('#select-error').textContent = 'Can\'t reach the server — retrying…'; }
  });
  socket.on('connect', () => { $('#select-error').textContent = ''; if (!game) loadChars(); });
  socket.on('kicked', (d) => { alert(d.reason); });
  socket.on('online', (d) => setOnline(d.n));
  socket.on('announce', (d) => { ui.chatLine('', `📣 ${d.text}`, true); ui.center(d.text, 5000); });
  socket.on('disconnect', () => {
    if (game) { ui.msg('Connection lost — reconnecting…', 'warn'); }
  });
  socket.io.on('reconnect', () => { if (game) { endGame(); loadChars(); $('#select-error').textContent = 'You were disconnected. Your hero was saved.'; } });
  voice = new Voice(socket, { onLevel: (pid, lvl) => ui.talking(pid, lvl), input: store.get('micId', ''), output: store.get('spkId', ''), micGain: Number(store.get('micGain', '1')), voiceVol: Number(store.get('voiceVol', '1')) });
  voice.setPtt(store.get('ptt', '0') === '1');
}

function loadChars() {
  socket.emit('chars', (r) => {
    if (!r?.ok) { $('#select-error').textContent = r?.error || 'Error'; return; }
    chars = r.chars; classes = r.classes;
    $('#who-name').textContent = `Signed in as ${r.username}`;
    show('select');
    renderHeroes();
    if (input.source === 'pad') setTimeout(focusTitle, 0);
  });
}

function renderHeroes() {
  const list = $('#hero-list');
  if (!chars.length) list.innerHTML = '<div class="empty">No heroes yet. Create one to begin.</div>';
  else list.innerHTML = chars.map((c) => `<button class="hero ${selected === c.id ? 'active' : ''}" data-id="${c.id}" type="button"><span class="portrait">${classes[c.cls]?.icon || '⚔'}</span><span class="meta"><b>${esc(c.name)}</b><small>Level ${c.level} ${esc(classes[c.cls]?.name || c.cls)} · deepest floor ${c.maxFloor || 1}</small></span></button>`).join('');
  $$('#hero-list .hero').forEach((b) => b.addEventListener('click', () => selectHero(Number(b.dataset.id))));
  const pick = chars.find((c) => c.id === selected) || chars[0];
  if (pick) selectHero(pick.id);
  if (!chars.length) { $('#play-buttons').classList.add('hidden'); $('#play-title').textContent = 'Choose a hero'; $('#play-info').textContent = ''; }
}

let preview = null;
// Show what a new hero of this class looks like, standing behind the menu.
function previewClass(cls) {
  if (preview) world.remove(preview);
  const town = generateTown();
  const st = classes[cls]?.starter || {};
  const look = { weapon: { kind: { sword: 'sword', axe: 'axe', staff: 'staff', mace: 'mace' }[st.weapon] || 'sword', tier: 0, rarity: 'common' }, offhand: st.offhand ? { tier: 0, rarity: 'common' } : null, chest: { tier: 0 } };
  preview = 'preview';
  world.add({ id: preview, k: 'p', pid: 'x', name: '', cls, look, x: town.start.x, y: town.start.y - 6, rot: 0 }, { me: true });
}
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
  $('#class-list').innerHTML = keys.map((k, i) => `<button class="class-opt ${i === 0 ? 'active' : ''}" data-cls="${k}" type="button"><b><span class="ci">${classes[k].icon || ''}</span> ${esc(classes[k].name)}</b><p>${esc(classes[k].blurb)}</p></button>`).join('');
  const pickClass = (b) => { $$('#class-list [data-cls]').forEach((x) => x.classList.toggle('active', x === b)); previewClass(b.dataset.cls); };
  $$('#class-list [data-cls]').forEach((b) => b.addEventListener('click', () => pickClass(b)));
  previewClass(keys[0]);
  $('#create-error').textContent = '';
  $('#hero-name').value = '';
  $('#create-modal').classList.remove('hidden');
  if (input.source === 'pad') $('#class-list .class-opt.active')?.focus(); else $('#hero-name').focus();
});
$('#create-modal [data-close]').addEventListener('click', () => { $('#create-modal').classList.add('hidden'); if (chars.some((c) => c.id === selected)) selectHero(selected); });
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
    // Capture Esc, the Windows key and other system shortcuts while full screen, so a handheld
    // that maps a controller button to one of them can't drop out of full screen or open other
    // windows. (Chrome/Edge: hold Esc to leave full screen.)
    try { await navigator.keyboard?.lock?.(); } catch { /* not supported */ }
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
document.addEventListener('fullscreenchange', () => { if (!fsElement()) navigator.keyboard?.unlock?.(); checkOrientation(); });
// No browser right-click menu anywhere in the game (handhelds often map B to a right-click).
document.addEventListener('contextmenu', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) e.preventDefault(); });
$('#fs-btn').addEventListener('click', (e) => {
  if (e.detail === 0 && input.source === 'pad') return; // a key press, not a tap: ignore while on the controller
  if (fsElement()) exitFullscreen(); else enterFullscreen();
});
// HUD buttons (full screen, map, bag, skills …) drop focus once tapped, so a later Enter/Space
// — or a controller button a handheld turns into one — can't press them again.
document.addEventListener('click', (e) => { const b = e.target.closest?.('#hud button'); if (b) setTimeout(() => b.blur(), 0); });
$('#rotate-fs').addEventListener('click', () => enterFullscreen());
$('#ios-tip-x').addEventListener('click', () => { $('#ios-tip').classList.add('hidden'); store.set('iosTip', '1'); });

// Players online (top right in game, under the play buttons on the hero screen) and the group finder.
function setOnline(n) {
  $('#online-btn b').textContent = n;
  $('#title-online').textContent = `${n} player${n === 1 ? '' : 's'} online`;
}
const groups = new GroupFinder({ ui, socket: () => socket, inGame: () => !!game, join: (code) => (game ? switchParty(code) : play('join', code)) });
for (const id of ['online-btn', 'find-group-btn', 'party-find']) $(`#${id}`).addEventListener('click', () => groups.open());
$('#host-listed').checked = store.get('hostListed', '1') === '1';
$('#host-listed').addEventListener('change', (e) => store.set('hostListed', e.target.checked ? '1' : '0'));

// Join another party from inside a game: the server moves this hero over.
function switchParty(code) {
  if (!selected) return;
  socket.emit('play', { charId: selected, mode: 'join', code }, (r) => {
    if (!r?.ok) { ui.msg(r?.error || 'Could not join that party', 'warn'); sfx.play('error'); return; }
    game?.destroy(); game = null;
    voice?.closeAll(); $('#mic-btn').classList.remove('on'); $('#voice-toggle').checked = false;
    ui.closePanels();
    startGame(r);
    ui.msg(`Joined ${r.code}`, 'good');
  });
}

function startGame(r) {
  if (preview) { world.remove(preview); preview = null; }
  voice.setMyPid(r.pid);
  game = new Game({ socket, world, input, ui, sfx, music, voice, me: r });
  show('hud');
  ui.setTouch(touchOn);
  world.targetDist = 15;
  checkOrientation();
}

async function play(mode, code) {
  if (!selected) return;
  if (coarse) enterFullscreen(); // must happen in the tap that starts the game
  if (coarse && isIOS && !standalone && store.get('iosTip') !== '1') $('#ios-tip').classList.remove('hidden');
  sfx.unlock();
  $('#select-error').textContent = '';
  $('#fade').classList.add('on');
  // The animated hero models load in the background; give a slow connection a few seconds.
  await Promise.race([Models.heroModelsReady, new Promise((r) => setTimeout(r, 6000))]);
  socket.emit('play', { charId: selected, mode, code, listed: mode === 'host' && $('#host-listed').checked }, (r) => {
    if (!r?.ok) { $('#fade').classList.remove('on'); $('#select-error').textContent = r?.error || 'Could not start'; return; }
    startGame(r);
    if (!r.solo) ui.msg(`Party code: ${r.code} — share it so friends can join`, 'good');
  });
}

function endGame() {
  game?.destroy(); game = null;
  music.setBoss(false); music.play('town');
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
    if (on) { await voice.start(); ui.msg('Microphone on', 'good'); fillDevices(); } else { voice.stop(); }
  } catch (e) { ui.msg(e.message || 'Microphone blocked', 'warn'); on = false; }
  $('#mic-btn').classList.toggle('on', on); $('#voice-toggle').checked = on;
}
$('#mic-btn').addEventListener('click', () => toggleMic(!voice.micOn));

// Audio devices and levels (Party panel)
async function fillDevices() {
  if (!voice) return;
  const d = await voice.listDevices();
  const fill = (sel, list, cur) => {
    sel.innerHTML = '<option value="">System default</option>' + list.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
    sel.value = list.some((x) => x.id === cur) ? cur : '';
  };
  fill($('#mic-select'), d.input, voice.devices.input);
  fill($('#spk-select'), d.output, voice.devices.output);
  $('#spk-field').classList.toggle('hidden', !voice.canPickOutput());
  $('#device-note').textContent = d.labelled ? (voice.canPickOutput() ? '' : 'This browser always uses the system speakers.')
    : 'Turn on voice chat once to see your device names.';
}
$('#menu-btn').addEventListener('click', () => setTimeout(fillDevices, 0));
navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);
$('#mic-select').addEventListener('change', async (e) => {
  store.set('micId', e.target.value);
  try { await voice.setInput(e.target.value); ui.msg('Microphone changed', 'good'); } catch { ui.msg('Could not open that microphone', 'warn'); }
});
$('#spk-select').addEventListener('change', (e) => { store.set('spkId', e.target.value); voice.setOutput(e.target.value); });
const pct = (v) => `${Math.round(v * 100)}%`;
$('#mic-gain').value = store.get('micGain', '1'); $('#mic-gain-val').textContent = pct(Number($('#mic-gain').value));
$('#mic-gain').addEventListener('input', (e) => { const v = Number(e.target.value); voice?.setMicGain(v); store.set('micGain', String(v)); $('#mic-gain-val').textContent = pct(v); });
$('#voice-vol').value = store.get('voiceVol', '1'); $('#voice-vol-val').textContent = pct(Number($('#voice-vol').value));
$('#voice-vol').addEventListener('input', (e) => { const v = Number(e.target.value); voice?.setVoiceVolume(v); store.set('voiceVol', String(v)); $('#voice-vol-val').textContent = pct(v); });
setInterval(() => {
  if ($('#menu-panel').classList.contains('hidden')) return;
  $('#mic-meter-bar').style.width = `${Math.round((voice?.micOn ? voice.myLevel() : 0) * 100)}%`;
}, 80);
$('#voice-toggle').addEventListener('change', (e) => toggleMic(e.target.checked));
$('#ptt-toggle').checked = store.get('ptt', '0') === '1';
$('#ptt-toggle').addEventListener('change', (e) => { voice?.setPtt(e.target.checked); store.set('ptt', e.target.checked ? '1' : '0'); });

// ------------------------------------------------------------ controller on the title screens
const vkbOpen = () => !$('#vkb').classList.contains('hidden');
function titleRoot() {
  if (vkbOpen()) return $('#vkb');
  if (!$('#groups-panel').classList.contains('hidden')) return $('#groups-panel');
  if (!$('#create-modal').classList.contains('hidden')) return $('#create-modal');
  return ['auth', 'select'].map((id) => $(`#${id}`)).find((el) => !el.classList.contains('hidden')) || null;
}
function focusTitle() {
  const root = titleRoot(); if (!root || root.contains(document.activeElement)) return;
  const vis = (el) => (el && el.offsetParent !== null ? el : null);
  const pick = vis(root.querySelector('.hero.active')) || vis(root.querySelector('.class-opt.active')) || vis(root.querySelector('#auth-user'))
    || vis(root.querySelector('#new-hero-btn')) || [...root.querySelectorAll('button, input')].find((e) => e.offsetParent !== null);
  pick?.focus({ preventScroll: true });
}
function titlePad(name) {
  const root = titleRoot(); if (!root) return;
  ui.navRoot = root;
  try {
    if (vkbOpen()) return vkbPad(name);
    const dirs = { padUp: 'up', padDown: 'down', padLeft: 'left', padRight: 'right' };
    if (dirs[name]) { if (!root.contains(document.activeElement)) focusTitle(); else ui.padNav(dirs[name]); return; }
    const a = document.activeElement;
    if (name === 'attack') { // A
      if (!root.contains(a)) { focusTitle(); return; }
      if (a.tagName === 'INPUT') openVkb(a); else a.click();
      setTimeout(focusTitle, 50);
      return;
    }
    if (name === 'skill2' && root.id === 'groups-panel') { groups.close(); setTimeout(focusTitle, 0); return; }
    if (name === 'skill2') { // B: back out of the new-hero window
      if (root.id === 'create-modal') { $('#create-modal').classList.add('hidden'); if (chars.some((c) => c.id === selected)) selectHero(selected); setTimeout(focusTitle, 0); }
      return;
    }
    if (root.id === 'select' && name === 'skill0') { $('#new-hero-btn').click(); setTimeout(() => $('#hero-name').blur() || focusTitle(), 50); return; } // X
    if (root.id === 'select' && name === 'skill1') { openVkb($('#join-code')); return; } // Y
    if (root.id === 'auth' && (name === 'use' || name === 'skill3')) { const tabs = $$('#auth .tab'); (tabs.find((t) => !t.classList.contains('active')))?.click(); return; } // LB/RB
  } finally { ui.navRoot = null; }
}

// On-screen keyboard
let vkbTarget = null; let vkbShift = true;
const VKB_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl\'', 'zxcvbnm-_.'];
function renderVkb() {
  const keys = VKB_ROWS.join('').split('').map((k) => {
    const ch = vkbShift ? k.toUpperCase() : k;
    return `<button type="button" data-k="${esc(ch)}">${esc(ch)}</button>`;
  }).join('');
  $('#vkb-keys').innerHTML = keys
    + '<button type="button" class="wide" data-act="shift">⇧ Shift</button><button type="button" class="wider" data-act="space">Space</button><button type="button" class="wide" data-act="del">⌫</button><button type="button" class="wide done" data-act="done">Done</button>';
  const v = vkbTarget.value;
  $('#vkb-text').textContent = vkbTarget.type === 'password' ? '•'.repeat(v.length) : v;
}
function vkbType(k) {
  const t = vkbTarget; const max = Number(t.maxLength) > 0 ? t.maxLength : 99;
  if (k === 'del') t.value = t.value.slice(0, -1);
  else if (k === 'space') { if (t.value.length < max) t.value += ' '; }
  else if (t.value.length < max) t.value += t.id === 'join-code' ? k.toUpperCase() : k;
  t.dispatchEvent(new Event('input', { bubbles: true }));
  if (vkbShift && k.length === 1 && t.id === 'hero-name') vkbShift = false; // Capitalize the first letter only
  const keep = document.activeElement?.dataset; renderVkb();
  const again = keep?.k ? $(`#vkb-keys [data-k="${CSS.escape(vkbShift ? keep.k.toUpperCase() : keep.k.toLowerCase())}"]`) : keep?.act ? $(`#vkb-keys [data-act="${keep.act}"]`) : null;
  again?.focus({ preventScroll: true });
}
function openVkb(input) {
  vkbTarget = input; vkbShift = input.id === 'join-code' || input.value.length === 0;
  const label = input.closest('label')?.querySelector('span')?.textContent || input.placeholder || 'Text';
  $('#vkb-label').textContent = label;
  renderVkb();
  $('#vkb').classList.remove('hidden');
  $('#vkb-keys button')?.focus({ preventScroll: true });
}
function closeVkb() {
  $('#vkb').classList.add('hidden');
  const t = vkbTarget; vkbTarget = null;
  // Jump to the button that uses what was typed.
  const next = { 'hero-name': '#create-hero-btn', 'join-code': '#join-btn', 'auth-user': '#auth-pass', 'auth-pass': '#auth-submit', 'mail-to': '#mail-find', 'bank-gold-n': '#bank-dep-gold' }[t?.id];
  t?.dispatchEvent(new Event('change', { bubbles: true }));
  (next ? $(next) : t)?.focus({ preventScroll: true });
}
function vkbPad(name) {
  const dirs = { padUp: 'up', padDown: 'down', padLeft: 'left', padRight: 'right' };
  if (dirs[name]) return ui.padNav(dirs[name]);
  if (name === 'attack') { document.activeElement?.closest('#vkb') ? document.activeElement.click() : $('#vkb-keys button')?.focus(); return; }
  if (name === 'skill0') return vkbType('del'); // X
  if (name === 'skill1') return vkbType('space'); // Y
  if (name === 'use') { vkbShift = !vkbShift; const f = document.activeElement?.dataset; renderVkb(); if (f?.k) $(`#vkb-keys [data-k="${CSS.escape(vkbShift ? f.k.toUpperCase() : f.k.toLowerCase())}"]`)?.focus(); return; } // LB
  if (name === 'skill2' || name === 'menu') closeVkb(); // B / Start
}
$('#vkb-keys').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.k) vkbType(b.dataset.k);
  else if (b.dataset.act === 'shift') { vkbShift = !vkbShift; renderVkb(); $('#vkb-keys [data-act="shift"]').focus(); }
  else if (b.dataset.act === 'done') closeVkb();
  else vkbType(b.dataset.act);
});

const NAME_A = ['Al', 'Bran', 'Cor', 'Dar', 'Ed', 'Gar', 'Hal', 'Is', 'Kael', 'Lor', 'Mor', 'Ro', 'Syl', 'Thal', 'Ul', 'Wen'];
const NAME_B = ['dric', 'wyn', 'ric', 'ven', 'mund', 'reth', 'ian', 'ora', 'en', 'is', 'gar', 'wen', 'ard', 'mir'];
$('#random-name-btn').addEventListener('click', () => {
  const r = (a) => a[Math.floor(Math.random() * a.length)];
  $('#hero-name').value = r(NAME_A) + r(NAME_B);
  if (input.source === 'pad') $('#create-hero-btn').focus();
});

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
window.__sc = { world, ui, get game() { return game; }, get socket() { return socket; } };


// ---------------------------------------------------------------- iOS page-zoom guard
// Safari ignores "user-scalable=no", so a double-tap or pinch can zoom the whole page (not the
// game camera) and leave it stuck. Block those gestures, and snap back if it zooms anyway.
(() => {
  const isText = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const t = Date.now();
    if (t - lastTap < 320 && !isText(e.target) && !e.target.closest?.('button, a, select, label, .slot')) e.preventDefault(); // double-tap zoom (buttons keep fast taps)
    lastTap = t;
  }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false }); // pinch
  const meta = document.querySelector('meta[name="viewport"]');
  const base = meta?.getAttribute('content') || '';
  const unzoom = () => {
    if (!window.visualViewport || window.visualViewport.scale <= 1.01 || isText(document.activeElement)) return;
    // Re-applying a viewport that forbids zoom makes Safari reset the page scale.
    meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no');
    setTimeout(() => meta.setAttribute('content', base), 400);
  };
  window.visualViewport?.addEventListener('resize', () => setTimeout(unzoom, 250));
  document.addEventListener('focusout', () => setTimeout(unzoom, 300));
})();
