// Group finder: parties whose leader listed them, with where they are, their levels and a Join
// button. Works from the hero select screen and in game (joining moves you to that party).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { knight: '🛡', berserker: '🪓', alchemist: '⚗', druid: '🌿' };

export class GroupFinder {
  // opts: { ui, socket(): Socket, join(code), inGame(): bool, sync(): synced level or null }
  constructor(opts) {
    this.o = opts;
    this.el = $('#groups-panel');
    this.timer = null;
    $('#groups-refresh').addEventListener('click', () => this.refresh());
  }
  isOpen() { return !this.el.classList.contains('hidden'); }

  open() {
    const { ui } = this.o;
    if (this.o.inGame()) ui.closePanels();
    this.el.classList.remove('hidden');
    ui.h.panelsChanged?.(true);
    $('#groups-list').innerHTML = '<div class="ah-empty">Looking…</div>';
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (this.isOpen()) this.refresh(); else clearInterval(this.timer); }, 5000);
  }
  close() { this.el.classList.add('hidden'); clearInterval(this.timer); }

  refresh() {
    const s = this.o.socket(); if (!s) return;
    s.emit('groups', {}, (r) => {
      if (!r?.ok) { $('#groups-status').textContent = 'Could not reach the server.'; return; }
      this.render(r);
    });
  }

  render(r) {
    const { ui } = this.o;
    const keep = ui.focusKey?.(document.activeElement);
    const groups = r.groups;
    $('#groups-status').textContent = `${r.online} player${r.online === 1 ? '' : 's'} online · ${groups.length ? `${groups.length} open part${groups.length === 1 ? 'y' : 'ies'}` : 'no open parties right now'}`;
    $('#groups-list').innerHTML = groups.length ? groups.map((g) => {
      const mine = g.code === r.mine;
      const lv = g.minLevel === g.maxLevel ? `Lv ${g.minLevel}` : `Lv ${g.minLevel}–${g.maxLevel}`;
      const btn = mine ? '<span class="muted" style="font-size:12px">Your party</span>'
        : `<button class="btn ${g.full ? '' : 'green'} small gj" type="button" data-gjoin="${esc(g.code)}" ${g.full ? 'disabled' : ''}>${g.full ? 'Full' : 'Join'}</button>`;
      return `<div class="group-row ${mine ? 'mine' : ''}">
        <div class="gt">${esc(g.leader)}'s party<small>${esc(g.where)} · ${lv} · ${g.size}/${g.max}</small></div>
        ${g.note ? `<div class="gn">“${esc(g.note)}”</div>` : ''}
        <div class="gm">${g.members.map((m) => `<span>${m.leader ? '👑 ' : ''}${ICON[m.cls] || ''} ${esc(m.name)} · ${m.level}</span>`).join('')}</div>
        <div class="gj">${btn}</div></div>`;
    }).join('') : `<div class="ah-empty">Nobody has listed a party yet.<br>Host a co-op party (with “List my party in the group finder” ticked) so others can find you${this.o.inGame() ? ', or list your party from the 👥 party window' : ''}.</div>`;
    this.el.querySelectorAll('[data-gjoin]').forEach((b) => b.addEventListener('click', () => this.join(b.dataset.gjoin)));
    if (ui.source === 'pad') { if (keep) ui.restoreFocus(keep); else if (!this.el.contains(document.activeElement)) ui.focusFirst(this.el); }
  }

  join(code) {
    this.close();
    this.o.join(code);
  }
}
