// HUD and panels: vitals, skill bar, messages, party frames, character sheet, shops, gate, menus.
import { SKILLS, SLOTS, SLOT_NAMES, RARITY_COLOR, itemLines, xpToNext, CLASSES, BASES, MATERIALS, RECIPES, CRAFT_BASES, salvageYield, makeItem, AUCTION, itemAura, ELEMENTS, SYNC, classBlocks } from '/shared/rules.js';
import { itemIcon, setIconClass } from './render/icons.js';
import { KEY_GLYPH, PAD_GLYPH } from './input.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();
const SLOT_PH = { weapon: 'Weapon', offhand: 'Shield', head: 'Helm', chest: 'Armor', hands: 'Gloves', feet: 'Boots', ring: 'Ring', amulet: 'Amulet' };

export class UI {
  constructor(h) {
    this.h = h; // { inv(op), interact, buy, potionBuy, gate(floor), leave, quality, voice, ... }
    this.char = null; this.derived = null; this.sel = null; this.source = 'keyboard';
    this.hud = $('#hud');
    this.hp = $('.vitals .hp'); this.mp = $('.vitals .mp'); this.xpEl = $('.vitals .xp');
    this.buildSkillbar();
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => this.closePanels()));
    $$('.sheet, .modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m && m.id !== 'create-modal') this.closePanels(); }));
    $$('#char-panel .tab').forEach((t) => t.addEventListener('click', () => this.tab(t.dataset.tab)));
    $$('#craft-panel [data-ctab]').forEach((t) => t.addEventListener('click', () => this.craftTab(t.dataset.ctab)));
    $('#salvage-common-btn').addEventListener('click', () => this.h.inv({ op: 'salvageCommon' }));
    $$('#ah-panel [data-atab]').forEach((t) => t.addEventListener('click', () => this.ahTab(t.dataset.atab)));
    for (const id of ['ah-slot', 'ah-rarity', 'ah-sort', 'ah-usable']) $(`#${id}`).addEventListener('change', () => { if (!this.ah) return; Object.assign(this.ah, { slot: $('#ah-slot').value, rarity: $('#ah-rarity').value, sort: $('#ah-sort').value, usable: $('#ah-usable').checked, page: 0, sel: null }); this.ahSearch(); });
    $('#ah-prev').addEventListener('click', () => { if (this.ah.page > 0) { this.ah.page--; this.ah.sel = null; this.ah.focusRows = true; this.ahSearch(); } });
    $('#ah-next').addEventListener('click', () => { if (this.ah.more) { this.ah.page++; this.ah.sel = null; this.ah.focusRows = true; this.ahSearch(); } });
    $('#ah-collect').addEventListener('click', () => this.ahDo({ op: 'collect' }));
    $('#inv-btn').addEventListener('click', () => this.toggle('char'));
    $('#menu-btn').addEventListener('click', () => this.toggle('menu'));
    $('#party-btn').addEventListener('click', () => this.toggle('party'));
    $('#minimap').addEventListener('click', () => $('#minimap').classList.toggle('big'));
    $('#use-prompt').addEventListener('click', () => this.h.interact());
    $('#leave-btn').addEventListener('click', () => this.h.leave());
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) this.h.chat(v); e.target.value = ''; this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
      e.stopPropagation();
    });
    this.labelsLayer = $('#labels');
    this.labelsLayer.addEventListener('click', (e) => { const id = e.target?.dataset?.id; if (id) this.h.pickup(id); });
    // spatial navigation for controllers inside panels
    this.focusIdx = 0;
  }

  // ------------------------------------------------------------ HUD
  buildSkillbar() {
    const bar = $('#skillbar');
    bar.innerHTML = '';
    this.skillEls = [];
    // Basic attack button: hold it (or Space) to keep attacking.
    const atk = document.createElement('button');
    atk.className = 'skill atk'; atk.title = 'Attack (hold)';
    atk.innerHTML = '<span>🗡</span><span class="key">Space</span>';
    atk.addEventListener('pointerdown', (e) => { e.preventDefault(); this.h.holdAttack?.(true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) atk.addEventListener(ev, () => this.h.holdAttack?.(false));
    bar.appendChild(atk);
    this.atkEl = atk;
    ['cleave', 'bash', 'charge', 'warcry'].forEach((id, i) => {
      const s = SKILLS[id];
      const el = document.createElement('button');
      el.className = 'skill'; el.title = s.name;
      el.innerHTML = `<span>${s.icon}</span><span class="key">${i + 1}</span><i class="cd"></i><span class="cdt"></span>`;
      el.addEventListener('click', () => this.h.skill(i));
      bar.appendChild(el);
      this.skillEls.push({ el, id });
    });
    for (const kind of ['hp', 'mp']) {
      const el = document.createElement('button');
      el.className = `skill pot ${kind}`; el.title = kind === 'hp' ? 'Health potion' : 'Mana potion';
      el.innerHTML = `<span>${kind === 'hp' ? '❤' : '✦'}</span><span class="key">${kind === 'hp' ? 'Q' : 'R'}</span><span class="cnt">0</span>`;
      el.addEventListener('click', () => this.h.potion(kind));
      bar.appendChild(el);
      this[`pot_${kind}`] = el;
    }
    this.touchSkills = $$('.tbtn.sk');
    this.touchSkills.forEach((b, i) => { b.innerHTML = `${SKILLS[['cleave', 'bash', 'charge', 'warcry'][i]].icon}<i class="cd"></i>`; });
  }

  // Point the skill bar (and touch buttons) at this hero's class skills.
  setClassSkills(ids) {
    this.skillEls.forEach((s, i) => {
      const sk = SKILLS[ids[i]]; if (!sk) return;
      s.id = ids[i]; s.el.title = sk.name; s.el.querySelector('span').textContent = sk.icon;
    });
    this.touchSkills.forEach((b, i) => { const sk = SKILLS[ids[i]]; if (sk) b.innerHTML = `${sk.icon}<i class="cd"></i>`; });
  }

  setSource(src) {
    this.source = src;
    document.body.classList.toggle('pad-on', src === 'pad');
    const G = src === 'pad' ? PAD_GLYPH : KEY_GLYPH;
    this.skillEls.forEach((s, i) => { s.el.querySelector('.key').textContent = G[`skill${i}`]; });
    this.atkEl.querySelector('.key').textContent = G.attack;
    this.pot_hp.querySelector('.key').textContent = G.hp; this.pot_mp.querySelector('.key').textContent = G.mp;
    this.useGlyph = src === 'pad' ? PAD_GLYPH.use : KEY_GLYPH.use;
  }

  setTouch(on) { $('#touch').classList.toggle('hidden', !on); document.body.classList.toggle('touch-on', on); }

  vitals(hp, hpMax, mp, mpMax) {
    this.hp.querySelector('i').style.transform = `scaleX(${Math.max(0, hp / hpMax)})`;
    this.hp.querySelector('span').textContent = `${Math.ceil(hp)} / ${hpMax}`;
    this.mp.querySelector('i').style.transform = `scaleX(${Math.max(0, mp / mpMax)})`;
    this.mp.querySelector('span').textContent = `${Math.floor(mp)} / ${mpMax}`;
  }

  xp(xp, next) { this.xpEl.querySelector('i').style.transform = `scaleX(${Math.min(1, xp / next)})`; this.xpEl.title = `${fmt(xp)} / ${fmt(next)} XP`; }

  skills(cds, now, mp) {
    if (!this.char) return;
    this.skillEls.forEach(({ el, id }, i) => {
      const rank = this.char.skills[id] || 0;
      const s = SKILLS[id];
      el.classList.toggle('locked', rank < 1);
      el.classList.toggle('nomana', rank >= 1 && mp < s.mana(rank));
      const left = Math.max(0, (cds[id] || 0) - now);
      el.querySelector('.cd').style.transform = `scaleY(${left / s.cd})`;
      el.querySelector('.cdt').textContent = left > 0.05 ? left.toFixed(left < 1 ? 1 : 0) : '';
      const t = this.touchSkills[i];
      if (t) { t.classList.toggle('locked', rank < 1); t.querySelector('.cd').style.setProperty('--p', `${(left / s.cd) * 100}%`); }
    });
  }

  potions(p) {
    this.pot_hp.querySelector('.cnt').textContent = p.hp; this.pot_mp.querySelector('.cnt').textContent = p.mp;
    $('#t-hp b').textContent = p.hp; $('#t-mp b').textContent = p.mp;
    if (this.char) this.char.potions = p;
  }

  msg(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `msg ${kind}`; el.textContent = text;
    const box = $('#messages'); box.appendChild(el);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => el.remove(), 3300);
  }

  lootMsg(it) {
    const el = document.createElement('div');
    el.className = 'msg loot'; el.innerHTML = `Picked up <b style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</b>`;
    $('#messages').appendChild(el); setTimeout(() => el.remove(), 3300);
  }

  center(text, ms = 2200) {
    const el = $('#center-msg'); el.textContent = text; el.classList.add('show');
    clearTimeout(this.centerT); this.centerT = setTimeout(() => el.classList.remove('show'), ms);
  }

  chatLine(name, text, sys = false) {
    const el = document.createElement('div');
    el.innerHTML = sys ? `<i>${esc(text)}</i>` : `<b>${esc(name)}:</b> ${esc(text)}`;
    const log = $('#chat-log'); log.appendChild(el);
    while (log.children.length > 30) log.firstChild.remove();
  }
  openChat() { $('#chat').classList.add('open'); const i = $('#chat-input'); i.classList.remove('hidden'); i.focus(); }
  closeChat() { $('#chat').classList.remove('open'); const i = $('#chat-input'); i.classList.add('hidden'); i.blur(); }

  prompt(text) {
    const el = $('#use-prompt');
    if (!text) { el.classList.add('hidden'); $('#t-use').classList.add('hidden'); return; }
    el.innerHTML = `<kbd>${this.useGlyph || 'E'}</kbd>${esc(text)}`;
    el.classList.remove('hidden'); $('#t-use').classList.remove('hidden');
  }

  target(v) {
    const el = $('#target-bar');
    if (!v || v.boss) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const n = el.querySelector('.name'); n.textContent = `${v.e.name || ''}  ·  Lv ${v.e.level || ''}`; n.classList.toggle('elite', !!v.e.elite);
    el.querySelector('i').style.width = `${Math.max(0, (v.hp / v.hpMax) * 100)}%`;
  }

  boss(v) {
    const el = $('#boss-bar');
    if (!v) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.name').textContent = v.e.name;
    el.querySelector('i').style.width = `${Math.max(0, (v.hp / v.hpMax) * 100)}%`;
  }

  zoneName(t) { $('#zone-name').textContent = t; }

  death(show, text = '') { $('#death').classList.toggle('hidden', !show); $('#death-text').textContent = text; }

  partyFrames(roster, myPid, hp = {}) {
    const box = $('#party-frames');
    const others = roster.filter((m) => m.pid !== myPid);
    box.innerHTML = others.map((m) => `<div class="pframe" data-pid="${m.pid}"><div class="n"><span>${esc(m.name)} <small>Lv ${m.sync ? `${m.sync} <span title="Synced down from ${m.level}">⇣${m.level}</span>` : m.level}</small></span><span class="talk">🔊</span></div><div class="b"><i></i></div></div>`).join('');
  }
  partyHp(pid, hp, hpMax, dead) {
    const f = $(`.pframe[data-pid="${pid}"]`);
    if (!f) return;
    f.querySelector('.b i').style.width = `${Math.max(0, (hp / hpMax) * 100)}%`;
    f.classList.toggle('dead', !!dead);
  }
  talking(pid, level) { const f = $(`.pframe[data-pid="${pid}"] .talk`); if (f) f.classList.toggle('on', level > 0.08); }

  partyPanel(p, myPid) {
    $('#party-code-badge').textContent = p.solo ? '' : p.code;
    $('#party-btn').classList.toggle('hidden', p.solo);
    $('#mic-btn').classList.toggle('hidden', p.solo);
    $('#party-code-line').innerHTML = p.solo ? 'Solo game' : `Party code <b>${esc(p.code)}</b> <button class="btn small" id="copy-code" type="button">Copy</button>`;
    $('#copy-code')?.addEventListener('click', () => { navigator.clipboard?.writeText(p.code).then(() => this.msg('Party code copied', 'good')).catch(() => {}); });
    $('#party-list').innerHTML = p.members.map((m) => `<div><span>${m.leader ? '👑 ' : ''}${esc(m.name)}${m.pid === myPid ? ' (you)' : ''}</span><span>Lv ${m.sync ? `${m.sync} <span title="Synced down from ${m.level}">⇣${m.level}</span>` : m.level} ${m.mic ? '🎙' : ''}${!p.solo && m.pid !== myPid ? ` <button class="btn small" data-duel="${m.pid}" type="button">⚔ Duel</button>` : ''}</span></div>`).join('');
    $$('#party-list [data-duel]').forEach((b) => b.addEventListener('click', () => { const m = p.members.find((x) => x.pid === b.dataset.duel); if (m) this.openDuelSetup(m); }));
  }

  // ------------------------------------------------------------ duels
  openDuelSetup(m) {
    this.closePanels();
    this.duelTo = m;
    $('#duel-target').textContent = m.name;
    const gold = this.char?.gold || 0;
    const inp = $('#duel-stake');
    inp.value = Math.min(Number(inp.value) || 0, gold);
    const note = () => { const v = Math.max(0, Math.min(gold, Math.floor(Number(inp.value) || 0))); inp.value = v; $('#duel-note').textContent = v ? `Winner takes ${(v * 2).toLocaleString()} gold. You have ${gold.toLocaleString()}.` : 'A friendly duel with no gold on the line.'; };
    const step = (up) => { const v = Number(inp.value) || 0; const st = v < 50 ? 10 : v < 500 ? 50 : v < 5000 ? 250 : 1000; inp.value = Math.max(0, up ? v + st : v - st); note(); };
    $('#duel-dn').onclick = () => step(false); $('#duel-up').onclick = () => step(true);
    inp.onchange = note; inp.onkeydown = (e) => e.stopPropagation();
    $('#duel-send').onclick = () => { this.h.duel({ op: 'challenge', to: m.pid, stake: Number(inp.value) || 0 }); this.closePanels(); };
    note();
    $('#duel-setup').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.focusFirst($('#duel-setup'));
  }
  duelInvite(d) {
    if (!d) { if (!$('#duel-invite').classList.contains('hidden')) this.closePanels(); return; }
    this.closePanels();
    $('#duel-invite-text').innerHTML = `<b>${esc(d.name)}</b> challenges you to a duel${d.stake ? ` for <b style="color:#ffd76a">${fmt(d.stake)} gold</b> each — winner takes ${fmt(d.stake * 2)}` : ' (no gold on the line)'}.`;
    $('#duel-accept').onclick = () => { this.h.duel({ op: 'accept' }); this.closePanels(); };
    $('#duel-decline').onclick = () => { this.h.duel({ op: 'decline' }); this.closePanels(); };
    $('#duel-invite').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.focusFirst($('#duel-invite'));
  }
  duelBar(d) {
    const el = $('#duel-bar');
    if (!d) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.a b').textContent = d.an; el.querySelector('.b b').textContent = d.bn;
    el.querySelector('.pot span').textContent = d.stake ? ` ${fmt(d.stake * 2)}g` : '';
  }
  duelHp(aFrac, bFrac) {
    const el = $('#duel-bar');
    el.querySelector('.a i').style.transform = `scaleX(${Math.max(0, aFrac)})`;
    el.querySelector('.b i').style.transform = `scaleX(${Math.max(0, bFrac)})`;
  }

  // ------------------------------------------------------------ panels
  anyOpen() { return $$('.sheet:not(.hidden), .modal:not(.hidden)').some((m) => m.id !== 'create-modal'); }
  closePanels() {
    for (const id of ['char-panel', 'shop-panel', 'craft-panel', 'ah-panel', 'gate-panel', 'party-panel', 'menu-panel', 'duel-setup', 'duel-invite', 'admin-panel']) $(`#${id}`).classList.add('hidden');
    this.sel = null; this.shopSel = null;
    $('#tooltip').classList.add('hidden');
    // Let go of whatever control had focus inside the closed window.
    const a = document.activeElement;
    if (a && a !== document.body && a.closest?.('.sheet, .modal') && a.closest('#create-modal') === null) a.blur();
    this.h.panelsChanged?.(false);
  }
  toggle(name) {
    const id = { char: 'char-panel', menu: 'menu-panel', party: 'party-panel' }[name];
    const el = $(`#${id}`);
    const was = !el.classList.contains('hidden');
    this.closePanels();
    if (!was) { el.classList.remove('hidden'); if (name === 'char') this.renderChar(); this.h.panelsChanged?.(true); this.focusFirst(el); }
  }
  open(name, tab) { const id = { char: 'char-panel', menu: 'menu-panel', party: 'party-panel' }[name]; this.closePanels(); $(`#${id}`).classList.remove('hidden'); if (name === 'char') { this.renderChar(); if (tab) this.tab(tab); } this.h.panelsChanged?.(true); this.focusFirst($(`#${id}`)); }

  tab(name) {
    $$('#char-panel .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('#char-panel .tab-body').forEach((b) => b.classList.toggle('hidden', b.dataset.body !== name));
    this.curTab = name;
    $('#item-detail').classList.toggle('hidden', name !== 'gear');
    this.renderChar();
    if (this.source === 'pad') this.focusFirst($('#char-panel'));
  }

  setChar(char, derived, next) {
    setIconClass(char?.cls);
    const sb = $('#sync-badge');
    if (sb) { sb.classList.toggle('hidden', !derived?.sync); if (derived?.sync) sb.textContent = `⇣ Synced to Lv ${derived.sync}`; }
    this.char = char; this.derived = derived; this.next = next;
    $('#pts-dot').classList.toggle('hidden', !(char.statPts > 0 || char.skillPts > 0));
    this.potions(char.potions);
    this.xp(char.xp, next);
    if (!$('#char-panel').classList.contains('hidden')) this.renderChar();
    if (!$('#shop-panel').classList.contains('hidden') && this.shopData) this.renderShop();
    if (this.craftSel) this.renderCraft();
    if (this.ah) this.renderAh();
  }

  // Can't wear it: level too low, or the class doesn't take it (Berserker + shield).
  cant(it, ch = this.char) { return !!(ch && it && (it.req > ch.level || classBlocks(ch.cls, it))); }

  slotHtml(it, extra = '', attrs = '') {
    const cls = it ? `slot ${it.rarity}${this.cant(it) ? ' cant' : ''}` : 'slot';
    const au = it ? itemAura(it) : null;
    const hex = au?.col != null ? `#${au.col.toString(16).padStart(6, '0')}` : null;
    const style = hex ? ` style="box-shadow: inset 0 0 14px ${hex}55, inset 0 0 2px ${hex}"` : '';
    return `<button class="${cls} ${extra}" ${attrs}${style} type="button">${it ? `<img src="${itemIcon(it)}" alt="" width="100%" draggable="false" style="max-width:56px">` : ''}${au?.el ? `<span class="elb">${ELEMENTS[au.el].icon}</span>` : ''}${it && this.isUpgrade(it) ? '<span class="up">▲</span>' : ''}</button>`;
  }

  // Small marker for items on the ground: ▲ upgrade, ✕ level too high.
  lootMark(it) {
    if (!this.char || !it) return '';
    if (it.req > this.char.level) return '<i class="mk bad" title="Level too high">✕</i>';
    if (classBlocks(this.char.cls, it)) return `<i class="mk bad" title="${CLASSES[this.char.cls].name}s can't use this">✕</i>`;
    if (!this.char.equip[it.slot]) return '<i class="mk up" title="Empty slot">▲</i>';
    return this.isUpgrade(it) ? '<i class="mk up" title="Upgrade">▲</i>' : '';
  }

  showLootCard(it, anchorRect) {
    const tip = $('#tooltip');
    if (!it) { tip.classList.add('hidden'); this.tipItem = null; return; }
    if (this.tipItem !== it) { tip.innerHTML = this.itemCard(it); this.tipItem = it; }
    tip.classList.remove('hidden');
    const w = tip.offsetWidth; const h = tip.offsetHeight;
    let x = anchorRect ? anchorRect.left + anchorRect.width / 2 - w / 2 : innerWidth - w - 16;
    let y = anchorRect ? anchorRect.top - h - 10 : innerHeight / 2 - h / 2;
    x = Math.max(8, Math.min(innerWidth - w - 8, x)); y = Math.max(8, Math.min(innerHeight - h - 8, y));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  isUpgrade(it) {
    if (!this.char || !it || this.cant(it)) return false;
    const cur = this.char.equip[it.slot];
    return score(it) > score(cur) * 1.05;
  }

  renderChar() { this.keepFocus(() => this._renderChar()); }
  _renderChar() {
    const ch = this.char; const d = this.derived;
    if (!ch) return;
    const tab = this.curTab || 'gear';
    if (tab === 'gear') {
      $('#equip-grid').innerHTML = SLOTS.map((s) => `<div style="grid-area:${s}">${ch.equip[s] ? this.slotHtml(ch.equip[s], this.sel?.eq === s ? 'sel' : '', `data-eq="${s}"`) : `<button class="slot" data-eq="${s}" type="button"><span class="ph">${SLOT_PH[s]}</span></button>`}</div>`).join('');
      $('#inv-grid').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, this.sel?.inv === i ? 'sel' : '', `data-inv="${i}"`)).join('');
      $('#gold-amt').textContent = fmt(ch.gold);
      $('#pot-line').innerHTML = `❤ ${ch.potions.hp}  ✦ ${ch.potions.mp}${this.matsLine()}`;
      $$('#equip-grid [data-eq]').forEach((b) => b.addEventListener('click', () => { this.sel = { eq: b.dataset.eq }; this.renderChar(); }));
      $$('#inv-grid [data-inv]').forEach((b) => {
        b.addEventListener('click', () => { this.sel = { inv: Number(b.dataset.inv) }; this.renderChar(); });
        b.addEventListener('dblclick', () => { const i = Number(b.dataset.inv); if (ch.inv[i]) this.h.inv({ op: 'equip', idx: i }); });
      });
      this.renderDetail();
    } else if (tab === 'stats') {
      const row = (k, label, help) => `<div class="attr"><div class="lab">${label}<small>${help}</small></div><b>${d[k]}</b><button class="plus-btn" data-stat="${k}" ${ch.statPts > 0 ? '' : 'disabled'} type="button" aria-label="Add ${label}">+</button></div>`;
      $('#stats-body').innerHTML = `
        <h2 style="margin-bottom:4px">${esc(ch.name)}</h2>
        <div class="muted" style="margin-bottom:10px">Level ${d.sync ? `${d.sync} (synced down from ${ch.level})` : ch.level} ${CLASSES[ch.cls].name} · ${fmt(ch.xp)} / ${fmt(this.next)} XP · Deepest floor ${ch.maxFloor}</div>
        ${d.sync ? `<div class="sync-note">⇣ Synced to level ${d.sync} to match the lowest-level hero in your group (or this floor): stats and gear are scaled down, all your skills are kept, and you earn +${Math.round(SYNC.xpBonus * 100)}% XP.</div>` : ''}
        ${ch.statPts > 0 ? `<div class="pts">${ch.statPts} attribute point${ch.statPts > 1 ? 's' : ''} to spend</div>` : ''}
        ${row('str', 'Strength', '+1.5% damage per point')}
        ${row('dex', 'Dexterity', 'Critical chance and armor')}
        ${row('vit', 'Vitality', '+3 life per point')}
        ${row('spi', 'Spirit', '+3 mana and faster mana regen')}
        <div class="stats-grid" style="margin-top:14px">
          <div>Damage <b>${d.dmg[0]}–${d.dmg[1]}</b></div><div>Attacks / sec <b>${(1 / d.atkInterval).toFixed(2)}</b></div>
          <div>Life <b>${d.hpMax}</b></div><div>Mana <b>${d.mpMax}</b></div>
          <div>Armor <b>${d.armor}</b></div><div>Block <b>${d.block}%</b></div>
          <div>Critical <b>${d.crit}%</b></div><div>Life steal <b>${d.lifeSteal}%</b></div>
          <div>Life regen <b>${d.hpRegen}/s</b></div><div>Move speed <b>${d.moveSpeed}</b></div>
          <div>Gold find <b>+${d.goldFind}%</b></div><div>Monsters slain <b>${fmt(ch.kills || 0)}</b></div>
        </div>`;
      $$('#stats-body [data-stat]').forEach((b) => b.addEventListener('click', () => this.h.inv({ op: 'stat', stat: b.dataset.stat })));
    } else {
      const cls = CLASSES[ch.cls];
      $('#skills-body').innerHTML = `${ch.skillPts > 0 ? `<div class="pts">${ch.skillPts} skill point${ch.skillPts > 1 ? 's' : ''} to spend</div>` : '<div class="muted" style="margin-bottom:8px">You earn a skill point every level.</div>'}` + cls.skills.map((id, i) => {
        const s = SKILLS[id]; const r = ch.skills[id] || 0;
        const can = ch.skillPts > 0 && ch.level >= s.unlock && r < s.max;
        return `<div class="skill-row"><div class="skill ${r ? '' : 'locked'}"><span>${s.icon}</span><span class="key">${i + 1}</span></div>
          <div><b>${s.name}</b> <span class="muted">Rank ${r}/${s.max}${ch.level < s.unlock ? ` · unlocks at level ${s.unlock}` : ''}</span>
          <p>${s.desc(Math.max(1, r))} Costs ${s.mana(Math.max(1, r))} mana · ${s.cd}s cooldown.</p></div>
          <button class="plus-btn" data-skill="${id}" ${can ? '' : 'disabled'} type="button" aria-label="Train ${s.name}">+</button></div>`;
      }).join('');
      $$('#skills-body [data-skill]').forEach((b) => b.addEventListener('click', () => this.h.inv({ op: 'skill', skill: b.dataset.skill })));
    }
  }

  itemCard(it, { compare = null, price = null } = {}) {
    if (!it) return '';
    const ch = this.char;
    const lines = itemLines(it);
    const base = BASES[it.base];
    const typeName = it.baseName ? `${it.baseName} · ` : '';
    let cmp = '';
    if (compare !== false) {
      const cur = compare ?? ch?.equip[it.slot];
      if (cur && cur !== it) {
        const dv = score(it) - score(cur);
        cmp = `<div class="cmp">vs equipped: <span class="${Math.abs(dv) < 1e-6 ? 'same' : dv > 0 ? 'plus' : 'minus'}">${Math.abs(dv) < 1e-6 ? 'the same' : dv > 0 ? 'better' : 'worse'}</span> (${esc(cur.name)})</div>`;
      }
    }
    return `<div class="idet"><div class="nm" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</div>
      <div class="ty">${typeName}${it.rarity[0].toUpperCase()}${it.rarity.slice(1)} ${SLOT_NAMES[it.slot]} · item level ${it.ilvl}</div>
      <ul>${lines.map((l, i) => { const el = Object.values(ELEMENTS).find((e) => l.includes(`${e.name === 'Frost' ? 'Cold' : e.name} Damage`)); return `<li class="${i >= (it.dmg ? 2 : 0) + (it.armor ? 1 : 0) + (it.block ? 1 : 0) ? 'mod' : ''}"${el ? ` style="color:${el.css}"` : ''}>${el ? `${el.icon} ` : ''}${esc(l)}</li>`; }).join('')}</ul>
      ${it.crafted ? `<div style="font-size:12px;color:#c9a0ff;margin-top:4px">Crafted by ${esc(it.crafted)}</div>` : ''}
      <div class="req ${ch && it.req > ch.level ? 'bad' : ''}" style="font-size:12px;margin-top:4px">Requires level ${it.req} · ${price != null ? `Price <b style="color:#ffd76a">${fmt(price)}</b>` : `Sells for ${fmt(it.value)} gold`}</div>${ch && classBlocks(ch.cls, it) ? `<div class="req bad" style="font-size:12px">${CLASSES[ch.cls].name}s can't use shields</div>` : ''}${cmp}</div>`;
  }

  renderDetail() {
    const box = $('#item-detail');
    const ch = this.char;
    if (!this.sel) { box.innerHTML = '<div class="muted" style="font-size:13px">Select an item. Double-click to equip. Dropped items stay on the ground for a few minutes.</div>'; return; }
    if (this.sel.eq) {
      const it = ch.equip[this.sel.eq];
      box.innerHTML = it ? `${this.itemCard(it, { compare: false })}<div class="idet acts" style="border:0;background:none;padding:0"><button class="btn small" id="act-unequip" type="button">Unequip</button></div>` : '';
      $('#act-unequip')?.addEventListener('click', () => this.h.inv({ op: 'unequip', slot: this.sel.eq }));
    } else {
      const it = ch.inv[this.sel.inv];
      if (!it) { box.innerHTML = ''; return; }
      box.innerHTML = `${this.itemCard(it)}<div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn small gold" id="act-equip" type="button" ${this.cant(it, ch) ? 'disabled' : ''}>Equip</button>
        ${this.h.nearShop() ? `<button class="btn small" id="act-sell" type="button">Sell (${fmt(it.value)}g)</button>` : ''}
        <button class="btn small ghost" id="act-drop" type="button">Drop</button></div>`;
      $('#act-equip')?.addEventListener('click', () => this.h.inv({ op: 'equip', idx: this.sel.inv }));
      $('#act-sell')?.addEventListener('click', () => this.h.inv({ op: 'sell', idx: this.sel.inv }));
      $('#act-drop')?.addEventListener('click', () => { this.h.inv({ op: 'drop', idx: this.sel.inv }); this.sel = null; });
    }
  }

  matsLine() {
    const m = this.char?.mats || {};
    const have = Object.entries(MATERIALS).filter(([k]) => m[k]);
    return have.length ? `<span class="mats">${have.map(([k, d]) => `<span style="color:${d.color}">${d.icon} ${m[k]}</span>`).join(' · ')}</span>` : '';
  }

  // ------------------------------------------------------------ artificer (crafting & salvage)
  openCraft() {
    this.closePanels();
    this.craftSel ||= { base: 'sword', recipe: 'apprentice', tab: 'craft' };
    $('#craft-result').innerHTML = '';
    $('#craft-panel').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.renderCraft();
    this.focusFirst($('#craft-panel'));
  }
  craftTab(name) { this.craftSel.tab = name; this.salvSel = null; this.renderCraft(); this.focusFirst($('#craft-panel')); }
  renderCraft() { if (!$('#craft-panel').classList.contains('hidden')) this.keepFocus(() => this._renderCraft()); }
  _renderCraft() {
    const ch = this.char; const sel = this.craftSel; const m = ch.mats || {};
    $$('#craft-panel [data-ctab]').forEach((t) => t.classList.toggle('active', t.dataset.ctab === sel.tab));
    $$('#craft-panel [data-cbody]').forEach((b) => b.classList.toggle('hidden', b.dataset.cbody !== sel.tab));
    $('#mat-bar').innerHTML = Object.entries(MATERIALS).map(([k, d]) => `<span class="mat-chip ${m[k] ? '' : 'zero'}" title="${esc(d.desc)}" style="color:${d.color}">${d.icon} <b>${m[k] || 0}</b> ${esc(d.name)}</span>`).join('')
      + `<span class="mat-chip" style="color:#ffd76a">🪙 <b>${fmt(ch.gold)}</b></span>`;
    if (sel.tab === 'craft') {
      const NAMES = { sword: 'Sword', axe: 'Axe', mace: 'Mace', staff: 'Staff', greataxe: 'Great Axe', greatsword: 'Greatsword', maul: 'Maul', shield: 'Shield', helm: 'Helm', chest: 'Armor', gloves: 'Gloves', boots: 'Boots', ring: 'Ring', amulet: 'Amulet' };
      $('#craft-bases').innerHTML = CRAFT_BASES.map((b) => {
        const preview = { slot: BASES[b].slot, kind: BASES[b].kind, tier: Math.min(5, Math.floor((ch.level - 1) / 6)), rarity: 'magic' };
        return `<button type="button" data-base="${b}" class="${sel.base === b ? 'sel' : ''}"><img src="${itemIcon(preview)}" alt="">${NAMES[b]}</button>`;
      }).join('');
      $('#craft-recipes').innerHTML = Object.entries(RECIPES).map(([k, r]) => {
        const gold = r.gold(ch.level);
        const lines = Object.entries(r.cost).map(([mk, n]) => `<span class="${(m[mk] || 0) < n ? 'short' : ''}" style="${(m[mk] || 0) >= n ? `color:${MATERIALS[mk].color}` : ''}">${MATERIALS[mk].icon} ${m[mk] || 0}/${n} ${esc(MATERIALS[mk].name)}</span>`);
        if (r.trophy) { const t = Math.max(m.tusk || 0, m.silk || 0); lines.push(`<span class="${t < r.trophy ? 'short' : ''}">🦷 ${t}/${r.trophy} boss trophy</span>`); }
        lines.push(`<span class="${ch.gold < gold ? 'short' : ''}">🪙 ${fmt(gold)} gold</span>`);
        const can = Object.entries(r.cost).every(([mk, n]) => (m[mk] || 0) >= n) && ch.gold >= gold && (!r.trophy || Math.max(m.tusk || 0, m.silk || 0) >= r.trophy);
        return `<button type="button" class="recipe ${can ? '' : 'cant'}" data-recipe="${k}"><div class="rn c-${r.rarity}">${r.name} ${esc(NAMES[sel.base])}</div><p>${esc(r.desc)} Item level ${ch.level + r.ilvlBonus}.</p><div class="cost">${lines.join('<br>')}</div></button>`;
      }).join('');
      $$('#craft-bases [data-base]').forEach((b) => b.addEventListener('click', () => { sel.base = b.dataset.base; this.renderCraft(); }));
      $$('#craft-recipes [data-recipe]').forEach((b) => b.addEventListener('click', () => this.h.inv({ op: 'craft', recipe: b.dataset.recipe, base: sel.base })));
    } else {
      $('#salvage-grid').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, this.salvSel === i ? 'sel' : '', `data-salv="${i}"`)).join('');
      $$('#salvage-grid [data-salv]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.salv); if (ch.inv[i]) { this.salvSel = i; this.renderCraft(); } }));
      const it = this.salvSel != null ? ch.inv[this.salvSel] : null;
      if (it) {
        const y = salvageYieldPreview(it);
        $('#salvage-detail').innerHTML = `${this.itemCard(it)}<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn small gold" id="salvage-btn" type="button">Salvage</button><span class="muted" style="font-size:12px">Gives about ${y}</span></div>`;
        $('#salvage-btn').addEventListener('click', () => { this.h.inv({ op: 'salvage', idx: this.salvSel }); this.salvSel = null; });
      } else $('#salvage-detail').innerHTML = '<div class="muted" style="font-size:13px">Pick an item from your pack.</div>';
      $('#salvage-common-btn').disabled = !ch.inv.some((x) => x?.rarity === 'common');
    }
  }
  craftResult(html) { $('#craft-result').innerHTML = html; }

  // ------------------------------------------------------------ auction house
  openAuction() {
    this.closePanels();
    this.ah ||= { tab: 'browse', slot: '', rarity: '', sort: 'price', usable: true, page: 0, rows: [], more: false, sel: null, sellIdx: null, price: 0, mine: [], owed: 0, loading: false };
    $('#ah-panel').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.ahTab(this.ah.tab);
    this.ahLoadMine(); // for the "gold waiting" dot
  }
  ahOpen() { return !$('#ah-panel').classList.contains('hidden'); }
  ahTab(name) {
    const A = this.ah; A.tab = name;
    if (name === 'browse') { A.focusRows = true; this.ahSearch(); }
    if (name === 'mine') this.ahLoadMine();
    this.renderAh();
    this.focusFirst($('#ah-panel'));
  }
  async ahSearch() {
    const A = this.ah; A.loading = true; this.renderAh();
    const r = await this.h.ah({ op: 'search', slot: A.slot, rarity: A.rarity, sort: A.sort, usable: A.usable, page: A.page });
    A.loading = false;
    if (r.error) { this.msg(r.error, 'warn'); this.renderAh(); return; }
    A.rows = r.rows; A.more = r.more;
    if (A.sel != null && !A.rows[A.sel]) A.sel = null;
    this.renderAh();
    // Controller: land on the first result after opening, switching tab or paging.
    if (this.source === 'pad' && (A.focusRows || !$('#ah-panel').contains(document.activeElement))) this.focusFirst($('#ah-panel'));
    A.focusRows = false;
  }
  async ahLoadMine() {
    const r = await this.h.ah({ op: 'mine' });
    if (r.error) return;
    this.ah.mine = r.rows; this.ah.owed = r.owed;
    this.renderAh();
  }
  async ahDo(d) {
    const r = await this.h.ah(d);
    if (r.error) this.msg(r.error, 'warn'); else if (r.ok) this.msg(r.ok, 'good');
    this.h.sfx?.(r.error ? 'error' : d.op === 'collect' ? 'gold' : 'click');
    return r;
  }
  async ahBuy() {
    const A = this.ah; const row = A.rows[A.sel]; if (!row || row.mine) return;
    const r = await this.ahDo({ op: 'buy', id: row.id, price: row.price });
    A.sel = null;
    this.ahSearch();
    if (!r.error && r.item) $('#ah-detail').innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px">You bought:</div>${this.itemCard(r.item)}`;
  }
  ahPickSell(i) { const it = this.char.inv[i]; if (!it) return; this.ah.sellIdx = i; this.ah.price = AUCTION.suggest(it); this.renderAh(); }
  async ahList() {
    const A = this.ah; if (A.sellIdx == null || !this.char.inv[A.sellIdx]) return;
    const r = await this.ahDo({ op: 'list', idx: A.sellIdx, price: A.price });
    if (!r.error) { A.sellIdx = null; this.ahLoadMine(); }
  }
  renderAh() { if (this.ahOpen()) this.keepFocus(() => this._renderAh()); }
  _renderAh() {
    const A = this.ah; const ch = this.char; if (!ch) return;
    $$('#ah-panel [data-atab]').forEach((t) => t.classList.toggle('active', t.dataset.atab === A.tab));
    $$('#ah-panel [data-abody]').forEach((b) => b.classList.toggle('hidden', b.dataset.abody !== A.tab));
    $('#ah-gold').textContent = fmt(ch.gold);
    $('#ah-owed-dot').classList.toggle('hidden', !(A.owed > 0));
    const row = (it, attrs, cls, sub, price) => `<button type="button" class="ah-row ${cls}" ${attrs}><img src="${itemIcon(it)}" alt=""><span class="nm c-${it.rarity}">${esc(it.name)}${this.isUpgrade(it) ? ' <span style="color:#7fe39a">▲</span>' : ''}</span><span class="pr">${price}</span><span class="sub">${sub}</span></button>`;
    if (A.tab === 'browse') {
      $('#ah-slot').value = A.slot; $('#ah-rarity').value = A.rarity; $('#ah-sort').value = A.sort; $('#ah-usable').checked = A.usable;
      $('#ah-list').innerHTML = A.rows.length ? A.rows.map((r, i) => row(r.item, `data-ahrow="${i}"`, `${A.sel === i ? 'sel' : ''}${this.cant(r.item, ch) ? ' cant' : ''}`,
        `iLvl ${r.item.ilvl} · Req ${r.item.req} · ${r.mine ? 'your listing' : esc(r.seller)}`, `${fmt(r.price)}g`)).join('')
        : `<div class="ah-empty">${A.loading ? 'Searching…' : 'Nothing for sale matches. Try other filters, or check back later.'}</div>`;
      $$('#ah-list [data-ahrow]').forEach((b) => b.addEventListener('click', () => { A.sel = Number(b.dataset.ahrow); this.renderAh(); }));
      $('#ah-pageno').textContent = `Page ${A.page + 1}`;
      $('#ah-prev').disabled = A.page === 0; $('#ah-next').disabled = !A.more;
      const r = A.sel != null ? A.rows[A.sel] : null;
      if (r) {
        const cant = r.mine ? 'This is your listing' : ch.gold < r.price ? 'Not enough gold' : !ch.inv.some((x) => !x) ? 'Your pack is full' : '';
        $('#ah-detail').innerHTML = `${this.itemCard(r.item)}<div class="ah-note">Sold by ${esc(r.seller)}</div><div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn gold" id="ah-buy" type="button" ${cant ? 'disabled' : ''}>Buy for ${fmt(r.price)} gold</button>${cant ? `<span class="muted" style="font-size:12px">${cant}</span>` : ''}</div>`;
        $('#ah-buy').addEventListener('click', () => this.ahBuy());
      } else if (!$('#ah-detail').textContent.includes('You bought')) $('#ah-detail').innerHTML = '<div class="muted" style="font-size:13px">Pick an item to see its stats.</div>';
    } else if (A.tab === 'sell') {
      $('#ah-sell-grid').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, A.sellIdx === i ? 'sel' : '', `data-ahsell="${i}"`)).join('');
      $$('#ah-sell-grid [data-ahsell]').forEach((b) => b.addEventListener('click', () => this.ahPickSell(Number(b.dataset.ahsell))));
      const it = A.sellIdx != null ? ch.inv[A.sellIdx] : null;
      const active = A.mine.filter((x) => x.status === 'active').length;
      if (it) {
        const get = A.price - Math.ceil(A.price * AUCTION.cut);
        $('#ah-sell-detail').innerHTML = `${this.itemCard(it)}
          <div class="ah-price"><button class="btn small" id="ah-pdn" type="button" aria-label="Lower price">−</button><input id="ah-price" type="number" min="1" max="${AUCTION.maxPrice}" value="${A.price}" inputmode="numeric" aria-label="Price"><button class="btn small" id="ah-pup" type="button" aria-label="Raise price">+</button><span class="muted" style="font-size:12px">gold</span>
          <button class="btn gold" id="ah-list-btn" type="button" ${active >= AUCTION.maxListings ? 'disabled' : ''}>List it</button></div>
          <div class="ah-note">A vendor would pay ${fmt(it.value)}g. Suggested price ${fmt(AUCTION.suggest(it))}g. You'll get ${fmt(get)}g after the 5% fee. ${active}/${AUCTION.maxListings} listings used.</div>`;
        const step = (up) => { const p = A.price; const n = up ? p * 1.12 + 1 : p * 0.88; A.price = Math.max(1, Math.min(AUCTION.maxPrice, sig2(n))); if (A.price === p) A.price = Math.max(1, p + (up ? 1 : -1)); this.renderAh(); };
        $('#ah-pdn').addEventListener('click', () => step(false));
        $('#ah-pup').addEventListener('click', () => step(true));
        $('#ah-price').addEventListener('change', (e) => { A.price = Math.max(1, Math.min(AUCTION.maxPrice, Math.floor(Number(e.target.value) || 1))); this.renderAh(); });
        $('#ah-price').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
        $('#ah-list-btn').addEventListener('click', () => this.ahList());
      } else $('#ah-sell-detail').innerHTML = `<div class="muted" style="font-size:13px">Pick an item from your pack. ${active}/${AUCTION.maxListings} listings used.</div>`;
    } else {
      const sold = A.mine.filter((x) => x.status === 'sold');
      $('#ah-collect').disabled = !(A.owed > 0);
      $('#ah-collect').textContent = A.owed > 0 ? `Collect ${fmt(A.owed)} gold` : 'Collect gold';
      $('#ah-mine-sum').textContent = sold.length ? `${sold.length} item${sold.length > 1 ? 's' : ''} sold!` : A.mine.length ? 'Nothing sold yet' : '';
      $('#ah-mine').innerHTML = A.mine.length ? A.mine.map((r, i) => r.status === 'sold'
        ? `<div class="ah-row sold mine-row"><img src="${itemIcon(r.item)}" alt=""><span class="nm c-${r.item.rarity}">${esc(r.item.name)}</span><span class="pr" style="color:#7fe39a">+${fmt(r.price - Math.ceil(r.price * AUCTION.cut))}g</span><span class="sub">Sold to ${esc(r.buyer || 'someone')} for ${fmt(r.price)}g</span></div>`
        : `<div class="ah-row mine-row"><img src="${itemIcon(r.item)}" alt=""><span class="nm c-${r.item.rarity}">${esc(r.item.name)}</span><span class="pr"><button class="btn small" data-ahcancel="${i}" type="button">Cancel</button></span><span class="sub">Listed for ${fmt(r.price)}g</span></div>`).join('')
        : '<div class="ah-empty">You have nothing listed. Use the Sell tab to put items up for sale.</div>';
      $$('#ah-mine [data-ahcancel]').forEach((b) => b.addEventListener('click', async () => { const r = A.mine[Number(b.dataset.ahcancel)]; if (r) { await this.ahDo({ op: 'cancel', id: r.id }); this.ahLoadMine(); } }));
    }
  }

  // ------------------------------------------------------------ shop
  openShop(data) {
    this.shopData = data;
    this.closePanels();
    $('#shop-panel').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.renderShop();
    this.focusFirst($('#shop-panel'));
  }

  renderShop() { this.keepFocus(() => this._renderShop()); }
  _renderShop() {
    const d = this.shopData; const ch = this.char;
    $('#shop-title').textContent = d.npc === 'smith' ? 'Hilda the Smith — Arms & Armor' : 'Brannoc the Trader — Potions & Trinkets';
    $('#shop-gold').textContent = fmt(ch.gold);
    $('#shop-potions').innerHTML = d.potions ? `
      <button class="btn" data-pot="hp" data-n="1" type="button">❤ Health potion — ${d.potions.hp}g</button>
      <button class="btn" data-pot="hp" data-n="5" type="button">×5 — ${d.potions.hp * 5}g</button>
      <button class="btn" data-pot="mp" data-n="1" type="button">✦ Mana potion — ${d.potions.mp}g</button>
      <button class="btn" data-pot="mp" data-n="5" type="button">×5 — ${d.potions.mp * 5}g</button>
      <span class="muted" style="align-self:center">You have ❤ ${ch.potions.hp} ✦ ${ch.potions.mp}</span>` : '';
    $$('#shop-potions [data-pot]').forEach((b) => b.addEventListener('click', () => this.h.inv({ op: 'potion', kind: b.dataset.pot, n: Number(b.dataset.n) })));
    $('#shop-stock').innerHTML = d.stock.length ? d.stock.map((it, i) => `<button class="shop-item ${this.shopSel?.buy === i ? 'sel' : ''}" data-buy="${i}" type="button"><img class="ic" src="${itemIcon(it)}" width="34" height="34" alt=""><span class="nm c-${it.rarity}">${esc(it.name)}</span>${this.isUpgrade(it) ? '<span style="color:#7fe39a">▲</span>' : ''}<span class="pr">${fmt(it.price)}g</span></button>`).join('') : '<div class="muted">Sold out until your next visit.</div>';
    $('#shop-sell').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, this.shopSel?.sell === i ? 'sel' : '', `data-sell="${i}"`)).join('');
    $$('#shop-stock [data-buy]').forEach((b) => b.addEventListener('click', () => { this.shopSel = { buy: Number(b.dataset.buy) }; this.renderShop(); }));
    $$('#shop-sell [data-sell]').forEach((b) => b.addEventListener('click', () => { this.shopSel = { sell: Number(b.dataset.sell) }; this.renderShop(); }));
    const box = $('#shop-detail');
    if (this.shopSel?.buy != null && d.stock[this.shopSel.buy]) {
      const it = d.stock[this.shopSel.buy];
      box.innerHTML = `${this.itemCard(it, { price: it.price })}<div style="margin-top:8px"><button class="btn gold small" id="shop-buy" type="button" ${ch.gold < it.price ? 'disabled' : ''}>Buy for ${fmt(it.price)} gold</button></div>`;
      $('#shop-buy').addEventListener('click', () => { this.h.inv({ op: 'buy', i: this.shopSel.buy }); this.shopSel = null; });
    } else if (this.shopSel?.sell != null && ch.inv[this.shopSel.sell]) {
      const it = ch.inv[this.shopSel.sell];
      box.innerHTML = `${this.itemCard(it)}<div style="margin-top:8px;display:flex;gap:8px"><button class="btn small" id="shop-sell-btn" type="button">Sell for ${fmt(it.value)} gold</button><button class="btn small gold" id="shop-eq-btn" type="button" ${this.cant(it, ch) ? 'disabled' : ''}>Equip</button></div>`;
      $('#shop-sell-btn').addEventListener('click', () => { this.h.inv({ op: 'sell', idx: this.shopSel.sell }); this.shopSel = null; });
      $('#shop-eq-btn').addEventListener('click', () => this.h.inv({ op: 'equip', idx: this.shopSel.sell }));
    } else box.innerHTML = '<div class="muted" style="font-size:13px">Pick something to buy, or an item from your pack to sell.</div>';
  }

  updateShopStock(d) { if (this.shopData && d.npc === this.shopData.npc) { this.shopData = d; this.renderShop(); } }

  // ------------------------------------------------------------ gate
  openGate(max) {
    this.closePanels();
    const floors = [];
    for (let f = 1; f <= max; f++) floors.push(`<button class="btn ${f % 5 === 0 ? 'boss' : ''}" data-floor="${f}" type="button">${f}${f % 5 === 0 ? ' ☠' : ''}</button>`);
    $('#gate-floors').innerHTML = floors.reverse().join('');
    $$('#gate-floors [data-floor]').forEach((b) => b.addEventListener('click', () => { this.closePanels(); this.h.gate(Number(b.dataset.floor)); }));
    $('#gate-panel').classList.remove('hidden');
    this.h.panelsChanged?.(true);
    this.focusFirst($('#gate-panel'));
  }

  controlsHelp(src) {
    $('#controls-help').innerHTML = src === 'pad'
      ? 'Left stick move · Right stick turn / tilt camera · D-pad ▲▼ zoom · <kbd>A</kbd> attack · <kbd>X</kbd><kbd>Y</kbd><kbd>B</kbd><kbd>RB</kbd> skills · <kbd>LT</kbd>/<kbd>RT</kbd> potions · <kbd>LB</kbd> use / pick up · <kbd>View</kbd> character · <kbd>Menu</kbd> menu<br>In menus: D-pad or left stick to move · right stick to scroll · <kbd>A</kbd> select · <kbd>X</kbd> equip / buy · <kbd>Y</kbd> drop (sell in shops) · <kbd>LB</kbd>/<kbd>RB</kbd> tabs · <kbd>B</kbd> back'
      : '<kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Space</kbd> or 🗡 button attack · <kbd>1</kbd>–<kbd>4</kbd> or skill buttons use skills (aimed at the cursor) · <kbd>Hold a mouse button + drag</kbd> turn camera · <kbd>Q</kbd>/<kbd>R</kbd> potions · <kbd>E</kbd> use / pick up · <kbd>I</kbd> character · <kbd>Z</kbd>/<kbd>X</kbd> also turn camera · <kbd>Wheel</kbd> zoom · <kbd>Tab</kbd> map · <kbd>Enter</kbd> chat · <kbd>V</kbd> push-to-talk';
  }

  // ------------------------------------------------------------ controller navigation in panels
  openPanelEl() { return this.navRoot || $$('.sheet:not(.hidden), .modal:not(.hidden)').find((m) => m.id !== 'create-modal'); }
  focusables(root) { return $$('button:not([disabled]), input, select', root).filter((e) => e.offsetParent !== null && !e.closest('.hidden')); }
  focusFirst(root) {
    if (this.source !== 'pad' || !root) return;
    const f = this.focusables(root);
    const el = f.find((e) => e.classList.contains('slot') || e.classList.contains('shop-item') || e.classList.contains('ah-row')) || f.find((e) => e.classList.contains('plus-btn')) || f.find((e) => !e.hasAttribute('data-close') && !e.closest('header')) || f[0];
    el?.focus({ preventScroll: true }); el?.scrollIntoView?.({ block: 'nearest' });
  }
  // A stable selector for the focused control, so focus survives a panel redraw.
  focusKey(el) {
    if (!el || !this.openPanelEl()?.contains(el)) return null;
    for (const k of ['inv', 'eq', 'buy', 'sell', 'stat', 'skill', 'pot', 'floor', 'tab', 'ctab', 'base', 'recipe', 'salv', 'atab', 'ahrow', 'ahsell', 'ahcancel']) {
      if (el.dataset[k] !== undefined) return { attr: k, val: el.dataset[k], n: el.dataset.n };
    }
    return el.id ? { id: el.id } : null;
  }
  restoreFocus(key) {
    if (!key || this.source !== 'pad') return;
    const root = this.openPanelEl(); if (!root) return;
    let el = null;
    if (key.id) el = root.querySelector(`#${key.id}`);
    else {
      const sel = (v) => `[data-${key.attr}="${v}"]${key.n ? `[data-n="${key.n}"]` : ''}`;
      el = root.querySelector(sel(key.val));
      // Bought/sold the last item in a list: move to the one before it.
      if (!el && /^\d+$/.test(key.val)) for (let i = Number(key.val) - 1; i >= 0 && !el; i--) el = root.querySelector(sel(i));
    }
    if (el && !el.disabled) el.focus({ preventScroll: true }); else this.focusFirst(root);
  }
  keepFocus(fn) { const k = this.focusKey(document.activeElement); fn(); this.restoreFocus(k); }

  padNav(dir) {
    const root = this.openPanelEl(); if (!root) return false;
    const items = this.focusables(root);
    const cur = document.activeElement && items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { this.focusFirst(root); return true; }
    // Left/right adjust sliders and dropdowns in the menu.
    if ((dir === 'left' || dir === 'right') && cur.tagName === 'SELECT') {
      const i = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + (dir === 'right' ? 1 : -1)));
      if (i !== cur.selectedIndex) { cur.selectedIndex = i; cur.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    }
    if ((dir === 'left' || dir === 'right') && cur.type === 'range') {
      if (dir === 'right') cur.stepUp(); else cur.stepDown();
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const r0 = cur.getBoundingClientRect(); const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null; let bd = 1e9;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(); const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x; const dy = c.y - c0.y;
      const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
      if (!ok) continue;
      const horiz = dir === 'left' || dir === 'right';
      const main = horiz ? Math.abs(dx) : Math.abs(dy);
      // Sideways distance counts only when the boxes don't line up at all.
      const cross = horiz ? Math.max(0, r.top - r0.bottom, r0.top - r.bottom) : Math.max(0, r.left - r0.right, r0.left - r.right);
      // Anything sharing the row (or column) wins over anything that doesn't, so left/right
      // flips between side-by-side cards instead of dropping onto a wide field below them.
      const d = main + cross * 2.5 + (cross > 0 ? 5000 : 0) + (horiz ? Math.abs(dy) : Math.abs(dx)) * 0.05;
      if (d < bd) { bd = d; best = el; }
    }
    if (best) { best.focus({ preventScroll: true }); best.scrollIntoView?.({ block: 'nearest' }); }
    // Nothing further down/up: scroll the window instead, so text below the last button is reachable.
    else if (dir === 'up' || dir === 'down') this.padScroll((dir === 'down' ? 1 : -1) * 160, root, true);
    return true;
  }

  // Right stick (or D-pad past the last item): scroll whichever part of the open window scrolls.
  scrollTarget(root) {
    if (!root) return null;
    const scrolls = (el) => { if (el.scrollHeight <= el.clientHeight + 2) return false; const o = getComputedStyle(el).overflowY; return o === 'auto' || o === 'scroll'; };
    for (let el = document.activeElement; el && root.contains(el); el = el.parentElement) if (scrolls(el)) return el;
    if (scrolls(root)) return root;
    let best = null; let area = 0;
    for (const el of root.querySelectorAll('*')) {
      if (el.offsetParent === null || !scrolls(el)) continue;
      const a = el.clientWidth * el.clientHeight; if (a > area) { area = a; best = el; }
    }
    return best;
  }
  padScroll(dy, root = this.openPanelEl(), smooth = false) {
    const el = this.scrollTarget(root); if (!el) return false;
    const before = el.scrollTop;
    el.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'instant' });
    // Keep the controller highlight on screen: if it scrolled out of view, move focus to a visible control.
    const a = document.activeElement;
    if (this.source === 'pad' && a && el.contains(a)) {
      const r = a.getBoundingClientRect(); const v = el.getBoundingClientRect();
      if (r.bottom < v.top || r.top > v.bottom) {
        const vis = this.focusables(el).filter((f) => { const fr = f.getBoundingClientRect(); return fr.top >= v.top && fr.bottom <= v.bottom; });
        const pick = dy > 0 ? vis[0] : vis[vis.length - 1];
        pick?.focus({ preventScroll: true });
      }
    }
    return el.scrollTop !== before || smooth;
  }

  // A: press the focused control (select an item, press a button, tick a box).
  padPress() {
    const a = document.activeElement;
    if (a && this.openPanelEl()?.contains(a)) { this.keepFocus(() => a.click()); return true; }
    this.focusFirst(this.openPanelEl());
    return false;
  }

  // X: the main action for the selected item: equip / unequip / buy / sell.
  padPrimary() {
    const root = this.openPanelEl(); if (!root) return;
    const ch = this.char;
    if (root.id === 'char-panel' && (this.curTab || 'gear') === 'gear') {
      const k = this.focusKey(document.activeElement);
      if (k?.attr === 'inv') this.sel = { inv: Number(k.val) };
      if (k?.attr === 'eq') this.sel = { eq: k.val };
      if (this.sel?.inv != null && ch.inv[this.sel.inv]) this.h.inv({ op: 'equip', idx: this.sel.inv });
      else if (this.sel?.eq && ch.equip[this.sel.eq]) this.h.inv({ op: 'unequip', slot: this.sel.eq });
    } else if (root.id === 'shop-panel') {
      const k = this.focusKey(document.activeElement);
      if (k?.attr === 'buy') this.shopSel = { buy: Number(k.val) };
      if (k?.attr === 'sell') this.shopSel = { sell: Number(k.val) };
      if (this.shopSel?.buy != null && this.shopData.stock[this.shopSel.buy]) { this.h.inv({ op: 'buy', i: this.shopSel.buy }); this.shopSel = null; }
      else if (this.shopSel?.sell != null && ch.inv[this.shopSel.sell]) { this.h.inv({ op: 'sell', idx: this.shopSel.sell }); this.shopSel = null; }
    } else if (root.id === 'craft-panel') {
      const k = this.focusKey(document.activeElement);
      if (this.craftSel.tab === 'craft') { if (k?.attr === 'recipe') this.h.inv({ op: 'craft', recipe: k.val, base: this.craftSel.base }); else this.padPress(); }
      else if (k?.attr === 'salv' && this.char.inv[Number(k.val)]) { this.h.inv({ op: 'salvage', idx: Number(k.val) }); this.salvSel = null; }
      else this.padPress();
    } else if (root.id === 'ah-panel') {
      const k = this.focusKey(document.activeElement); const A = this.ah;
      if (k?.attr === 'ahrow') { A.sel = Number(k.val); this.ahBuy(); }
      else if (k?.attr === 'ahsell' && this.char.inv[Number(k.val)]) { if (A.sellIdx !== Number(k.val)) this.ahPickSell(Number(k.val)); else this.ahList(); }
      else this.padPress();
    } else this.padPress();
  }

  // Y: sell the selected pack item at a shop (or equip it from the shop's sell list).
  padSecondary() {
    const root = this.openPanelEl(); if (!root) return;
    const k = this.focusKey(document.activeElement);
    if (root.id === 'char-panel' && k?.attr === 'inv' && this.char.inv[Number(k.val)]) { this.h.inv({ op: 'drop', idx: Number(k.val) }); this.sel = null; }
    if (root.id === 'shop-panel' && k?.attr === 'sell' && this.char.inv[Number(k.val)]) this.h.inv({ op: 'equip', idx: Number(k.val) });
  }

  // LB / RB: switch tabs on the character panel.
  padTab(step) {
    const root = this.openPanelEl();
    if (root?.id === 'craft-panel') { this.craftTab(this.craftSel.tab === 'craft' ? 'salvage' : 'craft'); return; }
    if (root?.id === 'ah-panel') { const t = ['browse', 'sell', 'mine']; this.ahTab(t[(t.indexOf(this.ah.tab) + step + 3) % 3]); return; }
    if (root?.id !== 'char-panel') return;
    const tabs = ['gear', 'stats', 'skills'];
    const i = (tabs.indexOf(this.curTab || 'gear') + step + tabs.length) % tabs.length;
    this.tab(tabs[i]);
    this.focusFirst(root);
  }
}

// Round to two significant figures so prices step in tidy amounts (120, 130 … 1,200, 1,300).
function sig2(n) { if (n < 100) return Math.round(n); const m = 10 ** (Math.floor(Math.log10(n)) - 1); return Math.round(n / m) * m; }

function salvageYieldPreview(it) {
  const ranges = { common: [['scrap', '2–3']], magic: [['scrap', '1–2'], ['dust', '1–2']], rare: [['dust', '2–3'], ['shard', '1–2']], legendary: [['shard', '2–3'], ['core', '1+']] }[it.rarity] || [];
  return ranges.map(([k, n]) => `<span style="color:${MATERIALS[k].color}">${n} ${MATERIALS[k].name}</span>`).join(' + ');
}

function confirmDestroy(it) { return window.confirm(`Destroy ${it.name}? This can't be undone.`); }

export function score(it) {
  if (!it) return 0;
  let s = 0;
  if (it.dmg) s += (it.dmg[0] + it.dmg[1]) * 1.5 / it.speed * 0.55;
  s += (it.armor || 0) + (it.block || 0) * 1.5;
  const w = { str: 2, dex: 1.5, vit: 2, spi: 1, life: 0.6, mana: 0.3, dmgPct: 1.5, armor: 1, lifeSteal: 4, atkSpd: 2, moveSpd: 1.5, crit: 2.5, regen: 3, gold: 0.3, block: 2, thorns: 1, fire: 3, frost: 3, shock: 3, poison: 3 };
  for (const [k, v] of Object.entries(it.mods || {})) s += v * (w[k] || 1);
  return s;
}

export { esc, $, $$ };
