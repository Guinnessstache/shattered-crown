// HUD and panels: vitals, skill bar, messages, party frames, character sheet, shops, gate, menus.
import { SKILLS, SLOTS, SLOT_NAMES, RARITY_COLOR, itemLines, xpToNext, CLASSES, BASES } from '/shared/rules.js';
import { itemIcon } from './render/icons.js';
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

  setSource(src) {
    this.source = src;
    const G = src === 'pad' ? PAD_GLYPH : KEY_GLYPH;
    this.skillEls.forEach((s, i) => { s.el.querySelector('.key').textContent = G[`skill${i}`]; });
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
    box.innerHTML = others.map((m) => `<div class="pframe" data-pid="${m.pid}"><div class="n"><span>${esc(m.name)} <small>Lv ${m.level}</small></span><span class="talk">🔊</span></div><div class="b"><i></i></div></div>`).join('');
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
    $('#party-list').innerHTML = p.members.map((m) => `<div><span>${m.leader ? '👑 ' : ''}${esc(m.name)}${m.pid === myPid ? ' (you)' : ''}</span><span>Lv ${m.level} ${m.mic ? '🎙' : ''}</span></div>`).join('');
  }

  // ------------------------------------------------------------ panels
  anyOpen() { return $$('.sheet:not(.hidden), .modal:not(.hidden)').some((m) => m.id !== 'create-modal'); }
  closePanels() {
    for (const id of ['char-panel', 'shop-panel', 'gate-panel', 'party-panel', 'menu-panel']) $(`#${id}`).classList.add('hidden');
    this.sel = null; this.shopSel = null;
    $('#tooltip').classList.add('hidden');
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
    this.renderChar();
  }

  setChar(char, derived, next) {
    this.char = char; this.derived = derived; this.next = next;
    $('#pts-dot').classList.toggle('hidden', !(char.statPts > 0 || char.skillPts > 0));
    this.potions(char.potions);
    this.xp(char.xp, next);
    if (!$('#char-panel').classList.contains('hidden')) this.renderChar();
    if (!$('#shop-panel').classList.contains('hidden') && this.shopData) this.renderShop();
  }

  slotHtml(it, extra = '', attrs = '') {
    const cls = it ? `slot ${it.rarity}${this.char && it.req > this.char.level ? ' cant' : ''}` : 'slot';
    return `<button class="${cls} ${extra}" ${attrs} type="button">${it ? `<img src="${itemIcon(it)}" alt="" width="100%" draggable="false" style="max-width:56px">` : ''}${it && this.isUpgrade(it) ? '<span class="up">▲</span>' : ''}</button>`;
  }

  isUpgrade(it) {
    if (!this.char || !it || it.req > this.char.level) return false;
    const cur = this.char.equip[it.slot];
    return score(it) > score(cur) * 1.05;
  }

  renderChar() {
    const ch = this.char; const d = this.derived;
    if (!ch) return;
    const tab = this.curTab || 'gear';
    if (tab === 'gear') {
      $('#equip-grid').innerHTML = SLOTS.map((s) => `<div style="grid-area:${s}">${ch.equip[s] ? this.slotHtml(ch.equip[s], this.sel?.eq === s ? 'sel' : '', `data-eq="${s}"`) : `<button class="slot" data-eq="${s}" type="button"><span class="ph">${SLOT_PH[s]}</span></button>`}</div>`).join('');
      $('#inv-grid').innerHTML = ch.inv.map((it, i) => this.slotHtml(it, this.sel?.inv === i ? 'sel' : '', `data-inv="${i}"`)).join('');
      $('#gold-amt').textContent = fmt(ch.gold);
      $('#pot-line').textContent = `❤ ${ch.potions.hp}  ✦ ${ch.potions.mp}`;
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
        <div class="muted" style="margin-bottom:10px">Level ${ch.level} ${CLASSES[ch.cls].name} · ${fmt(ch.xp)} / ${fmt(this.next)} XP · Deepest floor ${ch.maxFloor}</div>
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
        cmp = `<div class="cmp">vs equipped: <span class="${dv >= 0 ? 'plus' : 'minus'}">${dv >= 0 ? 'better' : 'worse'}</span> (${esc(cur.name)})</div>`;
      }
    }
    return `<div class="idet"><div class="nm" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</div>
      <div class="ty">${typeName}${it.rarity[0].toUpperCase()}${it.rarity.slice(1)} ${SLOT_NAMES[it.slot]} · item level ${it.ilvl}</div>
      <ul>${lines.map((l, i) => `<li class="${i >= (it.dmg ? 2 : 0) + (it.armor ? 1 : 0) + (it.block ? 1 : 0) ? 'mod' : ''}">${esc(l)}</li>`).join('')}</ul>
      <div class="req ${ch && it.req > ch.level ? 'bad' : ''}" style="font-size:12px;margin-top:4px">Requires level ${it.req} · ${price != null ? `Price <b style="color:#ffd76a">${fmt(price)}</b>` : `Sells for ${fmt(it.value)} gold`}</div>${cmp}</div>`;
  }

  renderDetail() {
    const box = $('#item-detail');
    const ch = this.char;
    if (!this.sel) { box.innerHTML = '<div class="muted" style="font-size:13px">Select an item. Double-click (or press A) to equip.</div>'; return; }
    if (this.sel.eq) {
      const it = ch.equip[this.sel.eq];
      box.innerHTML = it ? `${this.itemCard(it, { compare: false })}<div class="idet acts" style="border:0;background:none;padding:0"><button class="btn small" id="act-unequip" type="button">Unequip</button></div>` : '';
      $('#act-unequip')?.addEventListener('click', () => this.h.inv({ op: 'unequip', slot: this.sel.eq }));
    } else {
      const it = ch.inv[this.sel.inv];
      if (!it) { box.innerHTML = ''; return; }
      box.innerHTML = `${this.itemCard(it)}<div class="acts" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn small gold" id="act-equip" type="button" ${it.req > ch.level ? 'disabled' : ''}>Equip</button>
        ${this.h.nearShop() ? `<button class="btn small" id="act-sell" type="button">Sell (${fmt(it.value)}g)</button>` : ''}
        <button class="btn small ghost danger" id="act-drop" type="button">Destroy</button></div>`;
      $('#act-equip')?.addEventListener('click', () => this.h.inv({ op: 'equip', idx: this.sel.inv }));
      $('#act-sell')?.addEventListener('click', () => this.h.inv({ op: 'sell', idx: this.sel.inv }));
      $('#act-drop')?.addEventListener('click', () => { if (it.rarity === 'common' || confirmDestroy(it)) this.h.inv({ op: 'drop', idx: this.sel.inv }); });
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

  renderShop() {
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
      box.innerHTML = `${this.itemCard(it)}<div style="margin-top:8px;display:flex;gap:8px"><button class="btn small" id="shop-sell-btn" type="button">Sell for ${fmt(it.value)} gold</button><button class="btn small gold" id="shop-eq-btn" type="button" ${it.req > ch.level ? 'disabled' : ''}>Equip</button></div>`;
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
      ? 'Left stick move · Right stick camera · <kbd>A</kbd> attack · <kbd>X</kbd><kbd>Y</kbd><kbd>B</kbd><kbd>RB</kbd> skills · <kbd>LT</kbd>/<kbd>RT</kbd> potions · <kbd>LB</kbd> use / pick up · <kbd>View</kbd> character · <kbd>Menu</kbd> menu'
      : '<kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Left click</kbd>/<kbd>Space</kbd> attack · <kbd>Right click</kbd> Cleave · <kbd>1</kbd>–<kbd>4</kbd> skills · <kbd>Q</kbd>/<kbd>R</kbd> potions · <kbd>E</kbd> use / pick up · <kbd>I</kbd> character · <kbd>Z</kbd>/<kbd>X</kbd> or middle-drag rotate camera · <kbd>Wheel</kbd> zoom · <kbd>Tab</kbd> map · <kbd>Enter</kbd> chat · <kbd>V</kbd> push-to-talk';
  }

  // ------------------------------------------------------------ controller navigation in panels
  openPanelEl() { return $$('.sheet:not(.hidden), .modal:not(.hidden)').find((m) => m.id !== 'create-modal'); }
  focusables(root) { return $$('button:not([disabled]), input, select', root).filter((e) => e.offsetParent !== null); }
  focusFirst(root) { if (this.source !== 'pad') return; const f = this.focusables(root); (f.find((e) => e.classList.contains('slot') || e.classList.contains('shop-item')) || f[0])?.focus(); }
  padNav(dir) {
    const root = this.openPanelEl(); if (!root) return false;
    const items = this.focusables(root);
    const cur = document.activeElement && items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { items[0]?.focus(); return true; }
    const r0 = cur.getBoundingClientRect(); const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null; let bd = 1e9;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(); const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x; const dy = c.y - c0.y;
      const ok = dir === 'left' ? dx < -4 : dir === 'right' ? dx > 4 : dir === 'up' ? dy < -4 : dy > 4;
      if (!ok) continue;
      const main = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      const d = main + cross * 2.5;
      if (d < bd) { bd = d; best = el; }
    }
    best?.focus();
    best?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  padPress() { const a = document.activeElement; if (a && this.openPanelEl()?.contains(a)) { a.click(); if (a.dataset.inv && this.sel?.inv === Number(a.dataset.inv) && this.lastPadInv === a.dataset.inv) this.h.inv({ op: 'equip', idx: Number(a.dataset.inv) }); this.lastPadInv = a.dataset.inv; return true; } return false; }
}

function confirmDestroy(it) { return window.confirm(`Destroy ${it.name}? This can't be undone.`); }

export function score(it) {
  if (!it) return 0;
  let s = 0;
  if (it.dmg) s += (it.dmg[0] + it.dmg[1]) * 1.5 / it.speed * 0.55;
  s += (it.armor || 0) + (it.block || 0) * 1.5;
  const w = { str: 2, dex: 1.5, vit: 2, spi: 1, life: 0.6, mana: 0.3, dmgPct: 1.5, armor: 1, lifeSteal: 4, atkSpd: 2, moveSpd: 1.5, crit: 2.5, regen: 3, gold: 0.3, block: 2 };
  for (const [k, v] of Object.entries(it.mods || {})) s += v * (w[k] || 1);
  return s;
}

export { esc, $, $$ };
