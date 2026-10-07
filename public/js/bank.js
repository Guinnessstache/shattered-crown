// Bank window (Odo the Banker): item slots and gold shared by every hero on the account.
// Click an item to see it, then Store / Take. Double-click (or X on a controller) moves it at once.
import { BANK } from '/shared/rules.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => Math.floor(n).toLocaleString();

export class BankUI {
  constructor(ui, call) {
    this.ui = ui; this.call = call;
    this.bank = null; this.tab = 0; this.sel = null; this.busy = false;
    this.el = $('#bank-panel');
    $('#bank-dep-gold').addEventListener('click', () => this.gold('depositGold'));
    $('#bank-wd-gold').addEventListener('click', () => this.gold('withdrawGold'));
    $('#bank-gold-n').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  }
  isOpen() { return !this.el.classList.contains('hidden'); }

  async open() {
    this.ui.closePanels();
    this.el.classList.remove('hidden');
    this.ui.h.panelsChanged?.(true);
    this.sel = null;
    const r = await this.call({ op: 'open' });
    if (r.error) { this.ui.msg(r.error, 'warn'); this.ui.closePanels(); return; }
    this.bank = r.bank; this.tab = Math.min(this.tab, this.bank.tabs - 1);
    this.render();
    this.ui.focusFirst(this.el);
  }

  async act(d) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await this.call({ ...d, tab: this.tab });
      if (r.bank) this.bank = r.bank;
      if (r.error) { this.ui.msg(r.error, 'warn'); this.ui.h.sfx?.('error'); } else { if (r.ok) this.ui.msg(r.ok, 'good'); this.ui.h.sfx?.(/Gold/.test(d.op) || d.op === 'buyTab' ? 'gold' : 'pickup'); }
      return r;
    } finally { this.busy = false; this.render(); }
  }
  store(idx) { this.sel = null; return this.act({ op: 'deposit', idx }); }
  take(slot) { this.sel = null; return this.act({ op: 'withdraw', slot }); }
  gold(op) {
    const n = Math.floor(Number($('#bank-gold-n').value) || 0);
    if (n <= 0) { this.ui.msg('Enter how much gold', 'warn'); return; }
    this.act({ op, n }).then((r) => { if (r && !r.error) $('#bank-gold-n').value = ''; });
  }

  render() { if (this.isOpen() && this.bank) this.ui.keepFocus(() => this._render()); }
  _render() {
    const B = this.bank; const ch = this.ui.char; if (!ch) return;
    // tabs: owned ones, then the next one you can buy
    const tabs = [];
    for (let t = 0; t < BANK.maxTabs; t++) {
      if (t < B.tabs) tabs.push(`<button class="tab ${this.tab === t ? 'active' : ''}" data-btab="${t}" type="button">Tab ${t + 1}</button>`);
      else if (t === B.tabs) tabs.push(`<button class="tab locked ${this.tab === t ? 'active' : ''}" data-btab="${t}" type="button">🔒 ${fmt(BANK.tabCost[t])}g</button>`);
    }
    $('#bank-tabs').innerHTML = tabs.join('');
    $$('#bank-tabs [data-btab]').forEach((b) => b.addEventListener('click', () => { this.tab = Number(b.dataset.btab); this.sel = null; this.render(); }));
    $('#bank-gold').textContent = fmt(B.gold);
    $('#bank-mygold').textContent = fmt(ch.gold);

    const buying = this.tab >= B.tabs;
    const from = this.tab * BANK.tabSize;
    const slots = buying ? [] : B.slots.slice(from, from + BANK.tabSize);
    $('#bank-grid').innerHTML = buying
      ? `<div class="ah-empty" style="grid-column:1/-1">Another ${BANK.tabSize} slots for every hero on your account.<br><br><button class="btn gold" id="bank-buy-tab" type="button" ${ch.gold < BANK.tabCost[B.tabs] ? 'disabled' : ''}>Buy tab ${B.tabs + 1} for ${fmt(BANK.tabCost[B.tabs])} gold</button></div>`
      : slots.map((it, i) => this.ui.slotHtml(it, this.sel?.bank === from + i ? 'sel' : '', `data-bslot="${from + i}"`)).join('');
    $('#bank-buy-tab')?.addEventListener('click', () => this.act({ op: 'buyTab' }));
    $('#bank-pack').innerHTML = ch.inv.map((it, i) => this.ui.slotHtml(it, this.sel?.pack === i ? 'sel' : '', `data-bpack="${i}"`)).join('');

    const pick = (sel) => { this.sel = sel; this.render(); };
    $$('#bank-grid [data-bslot]').forEach((b) => {
      const i = Number(b.dataset.bslot);
      b.addEventListener('click', () => {
        if (B.slots[i]) return pick({ bank: i });
        // empty bank slot: put the picked item here
        const s = this.sel; this.sel = null;
        if (s?.pack != null) this.act({ op: 'deposit', idx: s.pack, to: i });
        else if (s?.bank != null) this.act({ op: 'move', from: s.bank, to: i });
      });
      b.addEventListener('dblclick', () => { if (B.slots[i]) this.take(i); });
    });
    $$('#bank-pack [data-bpack]').forEach((b) => {
      const i = Number(b.dataset.bpack);
      b.addEventListener('click', () => {
        if (ch.inv[i]) return pick({ pack: i });
        const s = this.sel; this.sel = null;
        if (s?.bank != null) this.act({ op: 'withdraw', slot: s.bank, to: i });
      });
      b.addEventListener('dblclick', () => { if (ch.inv[i]) this.store(i); });
    });

    const box = $('#bank-detail');
    const bi = this.sel?.bank != null ? B.slots[this.sel.bank] : null;
    const pi = this.sel?.pack != null ? ch.inv[this.sel.pack] : null;
    if (bi) {
      const full = !ch.inv.some((x) => !x);
      box.innerHTML = `${this.ui.itemCard(bi)}<div class="bank-actions"><button class="btn gold small" id="bank-take" type="button" ${full ? 'disabled' : ''}>Take</button>${full ? '<span class="muted" style="font-size:12px">Your pack is full</span>' : ''}<span class="muted" style="font-size:12px">or pick an empty bank slot to move it</span></div>`;
      $('#bank-take').addEventListener('click', () => this.take(this.sel.bank));
    } else if (pi) {
      const full = !B.slots.some((x) => !x);
      box.innerHTML = `${this.ui.itemCard(pi)}<div class="bank-actions"><button class="btn gold small" id="bank-store" type="button" ${full ? 'disabled' : ''}>Store in bank</button>${full ? '<span class="muted" style="font-size:12px">Your bank is full</span>' : ''}</div>`;
      $('#bank-store').addEventListener('click', () => this.store(this.sel.pack));
    } else {
      const used = B.slots.filter(Boolean).length;
      box.innerHTML = `<div class="muted" style="font-size:13px">${used} / ${B.slots.length} slots used. Pick an item to store or take it${this.ui.source === 'pad' ? ' (or press X to move it straight away)' : ' (double-click moves it straight away)'}.</div>`;
    }
  }

  // Controller X: move the focused item across at once.
  padPrimary(k) {
    if (k?.attr === 'bslot' && this.bank.slots[Number(k.val)]) { this.take(Number(k.val)); return true; }
    if (k?.attr === 'bpack' && this.ui.char.inv[Number(k.val)]) { this.store(Number(k.val)); return true; }
    return false;
  }
  padTab(step) {
    const n = Math.min(BANK.maxTabs, this.bank.tabs + 1);
    this.tab = (this.tab + step + n) % n; this.sel = null; this.render(); this.ui.focusFirst(this.el);
  }
}
