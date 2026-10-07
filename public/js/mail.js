// Mailbox window: read letters (take attached items and gold, send back, throw away) and write
// letters to any hero, with up to MAIL.maxItems items and some gold attached.
import { MAIL, postage } from '/shared/rules.js';
import { itemIcon } from './render/icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => Math.floor(n).toLocaleString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => {
  const d = new Date(iso); const ago = (Date.now() - d) / 1000;
  if (ago < 3600) return `${Math.max(1, Math.round(ago / 60))} min ago`;
  if (ago < 86400) return `${Math.round(ago / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const daysLeft = (iso) => Math.max(0, Math.ceil(MAIL.keepDays - (Date.now() - new Date(iso)) / 864e5));

export class MailUI {
  constructor(ui, call) {
    this.ui = ui; this.call = call;
    this.el = $('#mail-panel');
    this.tab = 'inbox'; this.rows = []; this.sel = null; this.busy = false;
    this.draft = { to: null, att: [], packSel: null };
    this.picks = []; // recipients to choose from (contacts or search results)
    $$('#mail-panel [data-mtab]').forEach((t) => t.addEventListener('click', () => this.setTab(t.dataset.mtab)));
    for (const id of ['mail-to', 'mail-subject', 'mail-body', 'mail-gold']) {
      $(`#${id}`).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && id === 'mail-to') { e.preventDefault(); this.find(); } });
    }
    $('#mail-find').addEventListener('click', () => this.find());
    // Typing a different name drops the hero picked before.
    $('#mail-to').addEventListener('input', () => { const d = this.draft; if (d.to && d.to.name.toLowerCase() !== $('#mail-to').value.trim().toLowerCase()) { d.to = null; this.render(); } });
    $('#mail-gold').addEventListener('input', () => this.renderCost());
    $('#mail-send').addEventListener('click', () => this.send());
  }
  isOpen() { return !this.el.classList.contains('hidden'); }

  open() {
    this.ui.closePanels();
    this.el.classList.remove('hidden');
    this.ui.h.panelsChanged?.(true);
    this.setTab(this.tab);
  }
  setTab(t) {
    this.tab = t;
    $$('#mail-panel [data-mtab]').forEach((b) => b.classList.toggle('active', b.dataset.mtab === t));
    $$('#mail-panel [data-mbody]').forEach((b) => b.classList.toggle('hidden', b.dataset.mbody !== t));
    if (t === 'inbox') this.loadInbox(); else { this.loadContacts(); this.render(); }
    this.ui.focusFirst(this.el);
  }

  async act(d) {
    if (this.busy) return { error: 'busy' };
    this.busy = true;
    try {
      const r = await this.call(d);
      if (r.error) { this.ui.msg(r.error, 'warn'); this.ui.h.sfx?.('error'); } else if (r.ok) this.ui.msg(r.ok, 'good');
      return r;
    } finally { this.busy = false; }
  }

  // ---------------------------------------------------------------- inbox
  async loadInbox() {
    const r = await this.call({ op: 'inbox' });
    if (r.error) { this.ui.msg(r.error, 'warn'); return; }
    this.rows = r.rows;
    this.ui.setMailUnread(r.unread);
    if (this.sel != null && !this.rows.some((x) => x.id === this.sel)) this.sel = null;
    this.render();
    if (this.ui.source === 'pad' && !this.el.contains(document.activeElement)) this.ui.focusFirst(this.el);
  }
  select(id) {
    this.sel = id;
    const m = this.rows.find((x) => x.id === id);
    if (m && !m.read) { m.read = true; this.call({ op: 'read', id }); this.ui.setMailUnread(this.rows.filter((x) => !x.read).length); }
    this.render();
  }
  async take(d) {
    const r = await this.act({ op: 'take', id: this.sel, ...d });
    if (!r.error) this.ui.h.sfx?.(d.gold && !d.all ? 'gold' : 'pickup');
    this.loadInbox();
  }

  // ---------------------------------------------------------------- writing
  async loadContacts() {
    if (this.picksFrom === 'search') return;
    const r = await this.call({ op: 'contacts' });
    if (r.heroes) { this.picks = r.heroes; this.picksFrom = 'contacts'; this.render(); }
  }
  async find() {
    const name = $('#mail-to').value.trim();
    if (name.length < 2) { this.picksFrom = null; this.loadContacts(); return; }
    const r = await this.call({ op: 'lookup', name });
    if (r.error) { this.ui.msg(r.error, 'warn'); return; }
    this.picks = r.heroes; this.picksFrom = 'search';
    if (!r.heroes.length) this.ui.msg(`No hero called ${name}`, 'warn');
    if (r.heroes.length === 1) this.draft.to = r.heroes[0];
    this.render();
  }
  toggleAttach(i) {
    const a = this.draft.att;
    const k = a.indexOf(i);
    if (k >= 0) a.splice(k, 1);
    else if (a.length >= MAIL.maxItems) { this.ui.msg(`Up to ${MAIL.maxItems} items per letter`, 'warn'); return; } else a.push(i);
    this.draft.packSel = null;
    this.render();
  }
  async send() {
    const d = this.draft;
    if (!d.to) {
      // Just typed a name: look it up. One hero with that name gets the letter; several, pick one.
      const name = $('#mail-to').value.trim();
      if (name.length < 2) { this.ui.msg('Type who the letter is for', 'warn'); $('#mail-to').focus(); return; }
      await this.find();
      if (!d.to) { if (this.picks.length > 1) this.ui.msg(`Several heroes are called ${name}. Pick one, then press Send`, 'warn'); return; }
    }
    const gold = Math.floor(Number($('#mail-gold').value) || 0);
    const need = postage(d.att.length) + gold;
    if ((this.ui.char?.gold ?? 0) < need) { this.ui.msg(`You need ${fmt(need)} gold to send this (${postage(d.att.length)} postage${gold ? ` + ${fmt(gold)} sent` : ''})`, 'warn'); this.ui.h.sfx?.('error'); return; }
    if (!$('#mail-body').value.trim() && !$('#mail-subject').value.trim() && !d.att.length && !gold) { this.ui.msg('Write a message first', 'warn'); $('#mail-body').focus(); return; }
    const r = await this.act({ op: 'send', to: d.to.id, subject: $('#mail-subject').value, body: $('#mail-body').value, items: d.att, gold: Math.floor(Number($('#mail-gold').value) || 0) });
    if (r.error) return;
    this.ui.h.sfx?.('gold');
    this.draft = { to: null, att: [], packSel: null };
    $('#mail-subject').value = ''; $('#mail-body').value = ''; $('#mail-gold').value = '0'; $('#mail-to').value = '';
    this.picksFrom = null; this.loadContacts();
    this.render();
  }
  reply(m) {
    this.draft = { to: { id: m.fromChar, name: m.from }, att: [], packSel: null };
    this.picks = [{ id: m.fromChar, name: m.from, clsName: '', level: '' }]; this.picksFrom = 'search';
    $('#mail-to').value = m.from;
    $('#mail-subject').value = (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`).slice(0, MAIL.subjectMax);
    this.setTab('send');
  }
  renderCost() {
    const n = this.draft.att.length; const gold = Math.max(0, Math.floor(Number($('#mail-gold').value) || 0));
    const fee = postage(n); const ch = this.ui.char;
    const total = fee + gold;
    const short = ch && ch.gold < total;
    $('#mail-cost').innerHTML = `Postage ${fee}g${gold ? ` + ${fmt(gold)}g sent = <b style="color:${short ? '#ff8a8a' : '#ffd76a'}">${fmt(total)}g</b>` : ''} · you have <span style="color:${short ? '#ff8a8a' : 'inherit'}">${fmt(ch?.gold || 0)}g</span>${short ? ' · <b style="color:#ff8a8a">not enough gold</b>' : ''}`;
  }

  // ---------------------------------------------------------------- drawing
  render() { if (this.isOpen()) this.ui.keepFocus(() => this._render()); }
  _render() {
    const ch = this.ui.char; if (!ch) return;
    $('#mail-unread-dot').classList.toggle('hidden', !this.rows.some((x) => !x.read));
    if (this.tab === 'inbox') {
      $('#mail-list').innerHTML = this.rows.length ? this.rows.map((m) => {
        const att = m.items.length ? `📦${m.items.length > 1 ? `×${m.items.length}` : ''}` : '';
        const gold = m.gold ? `🪙${fmt(m.gold)}` : '';
        const icon = m.items[0] ? `<img src="${itemIcon(m.items[0])}" alt="">` : `<img alt="" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"><text x="17" y="25" font-size="22" text-anchor="middle">' + (m.read ? '📄' : '✉️') + '</text></svg>')}">`;
        return `<button type="button" class="ah-row mail-row ${m.read ? '' : 'unread'} ${this.sel === m.id ? 'sel' : ''}" data-mrow="${m.id}">${icon}<span class="nm">${esc(m.subject)}${m.returned ? '<span class="tag">returned</span>' : ''}</span><span class="pr">${att} ${gold}</span><span class="sub">From ${esc(m.from)} · ${when(m.created)}</span></button>`;
      }).join('') : '<div class="ah-empty">No letters. Heroes can write to you here, and items or gold they attach wait on the letter until you take them.</div>';
      $$('#mail-list [data-mrow]').forEach((b) => b.addEventListener('click', () => this.select(Number(b.dataset.mrow))));
      const m = this.rows.find((x) => x.id === this.sel);
      const box = $('#mail-read');
      if (!m) { box.innerHTML = `<div class="muted" style="font-size:13px">${this.rows.length ? 'Pick a letter to read it.' : ''}</div>`; return; }
      const has = m.items.length || m.gold;
      const full = !ch.inv.some((x) => !x);
      box.innerHTML = `<h4>${esc(m.subject)}</h4><div class="meta">From <b>${esc(m.from)}</b> · ${when(m.created)}${m.returned ? ' · sent back to you' : has ? ` · returns to sender in ${daysLeft(m.created)} days if not taken` : ''}</div>
        <div class="body">${esc(m.body) || '<span class="muted">(no message)</span>'}</div>
        ${has ? `<div class="atts">${m.items.map((it, i) => this.ui.slotHtml(it, '', `data-matt="${i}" title="Take ${esc(it.name)}"`)).join('')}${m.gold ? `<button class="btn small" type="button" data-mgold="1">🪙 Take ${fmt(m.gold)} gold</button>` : ''}</div>` : ''}
        <div class="acts">
          ${has ? `<button class="btn gold small" id="mail-takeall" type="button" ${full && !m.gold ? 'disabled' : ''}>Take all</button>` : ''}
          ${m.returned ? '' : `<button class="btn small" id="mail-reply" type="button">Reply</button>`}
          ${!m.returned ? `<button class="btn small" id="mail-return" type="button">Send back</button>` : ''}
          ${has ? '' : `<button class="btn small ghost" id="mail-del" type="button">Throw away</button>`}
        </div><div id="mail-itemcard" class="item-detail"></div>`;
      $$('#mail-read [data-matt]').forEach((b) => {
        const i = Number(b.dataset.matt);
        b.addEventListener('click', () => this.take({ item: i }));
        b.addEventListener('mouseenter', () => { $('#mail-itemcard').innerHTML = this.ui.itemCard(m.items[i]); });
        b.addEventListener('focus', () => { $('#mail-itemcard').innerHTML = this.ui.itemCard(m.items[i]); });
      });
      $('#mail-read [data-mgold]')?.addEventListener('click', () => this.take({ gold: true }));
      $('#mail-takeall')?.addEventListener('click', () => this.take({ all: true }));
      $('#mail-reply')?.addEventListener('click', () => this.reply(m));
      $('#mail-return')?.addEventListener('click', async () => { const r = await this.act({ op: 'return', id: m.id }); if (!r.error) { this.sel = null; this.loadInbox(); } });
      $('#mail-del')?.addEventListener('click', async () => { const r = await this.act({ op: 'delete', id: m.id }); if (!r.error) { this.sel = null; this.loadInbox(); } });
      return;
    }
    // write
    const d = this.draft;
    d.att = d.att.filter((i) => ch.inv[i]);
    $('#mail-picks').innerHTML = (this.picks.length && this.picksFrom === 'contacts' ? '<span class="muted" style="font-size:12px;align-self:center">Quick pick:</span>' : '')
      + this.picks.map((h) => {
        // Names aren't unique: when several heroes match, say when each last played.
        const twins = this.picks.filter((o) => o.name.toLowerCase() === h.name.toLowerCase()).length > 1;
        const extra = h.why === 'yours' ? ' · your hero' : h.why === 'party' ? ' · party' : twins && h.played ? ` · played ${when(h.played)}` : '';
        return `<button type="button" class="mail-pick ${d.to?.id === h.id ? 'on' : ''}" data-mcontact="${h.id}">${esc(h.name)}${h.level ? ` <small>Lv ${h.level} ${esc(h.clsName)}${extra}</small>` : ''}</button>`;
      }).join('');
    $$('#mail-picks [data-mcontact]').forEach((b) => b.addEventListener('click', () => {
      const h = this.picks.find((x) => x.id === Number(b.dataset.mcontact));
      d.to = d.to?.id === h.id ? null : h;
      if (d.to) $('#mail-to').value = h.name;
      this.render();
    }));
    $('#mail-att').innerHTML = Array.from({ length: MAIL.maxItems }, (_, k) => {
      const i = d.att[k]; const it = i != null ? ch.inv[i] : null;
      return this.ui.slotHtml(it, '', it ? `data-mdetach="${i}" title="Remove ${esc(it.name)}"` : 'disabled tabindex="-1"');
    }).join('');
    $$('#mail-att [data-mdetach]').forEach((b) => b.addEventListener('click', () => this.toggleAttach(Number(b.dataset.mdetach))));
    $('#mail-pack').innerHTML = ch.inv.map((it, i) => this.ui.slotHtml(it, d.att.includes(i) ? 'sel' : '', `data-mpack="${i}"`)).join('');
    $$('#mail-pack [data-mpack]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.mpack); if (!ch.inv[i]) return;
      if (d.att.includes(i) || d.packSel === i || this.ui.source === 'touch') this.toggleAttach(i);
      else { d.packSel = i; this.render(); }
    }));
    const pi = d.packSel != null ? ch.inv[d.packSel] : null;
    $('#mail-detail').innerHTML = pi
      ? `${this.ui.itemCard(pi)}<div class="bank-actions"><button class="btn gold small" id="mail-attach" type="button">Attach to letter</button></div>`
      : `<div class="muted" style="font-size:13px">${d.att.length}/${MAIL.maxItems} attached. Click an item twice to attach it${this.ui.source === 'pad' ? ', or press X' : ''}. The postage is ${MAIL.postage}g plus ${MAIL.perItem}g per item.</div>`;
    $('#mail-attach')?.addEventListener('click', () => this.toggleAttach(d.packSel));
    $('#mail-send').textContent = d.to ? `Send to ${d.to.name}` : 'Send';
    this.renderCost();
  }

  padPrimary(k) {
    if (this.tab === 'send' && k?.attr === 'mpack' && this.ui.char.inv[Number(k.val)]) { this.toggleAttach(Number(k.val)); return true; }
    if (this.tab === 'inbox' && k?.attr === 'mrow') { this.select(Number(k.val)); const m = this.rows.find((x) => x.id === this.sel); if (m && (m.items.length || m.gold)) this.take({ all: true }); return true; }
    return false;
  }
  padTab() { this.setTab(this.tab === 'inbox' ? 'send' : 'inbox'); }
}
