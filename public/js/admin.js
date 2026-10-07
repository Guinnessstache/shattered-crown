// Admin console window. Opened by typing /console in chat; the server checks the admin
// password and only then answers admin requests on this connection.
import { esc, $, $$ } from './ui.js';

const fmt = (n) => Number(n || 0).toLocaleString();
const ago = (t) => {
  if (!t) return '—';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export class AdminConsole {
  constructor({ ui, socket }) {
    this.ui = ui; this.socket = socket; // socket is a getter: the connection changes on reconnect
    this.el = $('#admin-panel');
    this.authed = false; this.tab = 'online'; this.acct = null;
    $('#adm-login-btn').addEventListener('click', () => this.login());
    $('#adm-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.login(); });
    $('#adm-logout').addEventListener('click', () => this.logout());
    $$('#admin-panel [data-adm-tab]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.admTab)));
    $('#adm-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.search(); });
    $('#adm-search-btn').addEventListener('click', () => this.search());
    $('#adm-refresh').addEventListener('click', () => this.loadOnline());
    $('#adm-announce-btn').addEventListener('click', () => this.announce());
    $('#adm-announce').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.announce(); });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.tagName === 'INPUT') e.target.blur(); });
    // Clicks inside the lists (rows and action buttons are drawn on the fly)
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const { act, id } = b.dataset;
      if (act === 'open') this.openAccount(Number(id));
      if (act === 'back') this.show('accounts');
      if (act === 'reset') this.resetPassword();
      if (act === 'kick') this.kick();
      if (act === 'ban') this.ban(true);
      if (act === 'unban') this.ban(false);
      if (act === 'give') this.give(Number(id), b.dataset.what);
      if (act === 'copy') navigator.clipboard?.writeText(b.dataset.text).then(() => this.status('Copied', 'ok'), () => {});
    });
  }

  req(op, data = {}) {
    return new Promise((res) => {
      const s = this.socket();
      if (!s?.connected) { res({ ok: false, error: 'Not connected to the server' }); return; }
      const t = setTimeout(() => res({ ok: false, error: 'The server didn\'t answer' }), 8000);
      s.emit('admin', { op, ...data }, (r) => { clearTimeout(t); res(r || { ok: false, error: 'No reply' }); });
    }).then((r) => {
      // Reconnected since logging in? The server forgot us, so ask for the password again.
      if (!r.ok && /not logged in/i.test(r.error || '')) { this.authed = false; this.render(); }
      return r;
    });
  }

  status(text, kind = 'err') {
    const el = $('#adm-status'); el.textContent = text || ''; el.className = `adm-status ${kind}`;
    clearTimeout(this.statusT); if (text) this.statusT = setTimeout(() => { el.textContent = ''; }, 6000);
  }

  open() {
    this.ui.closePanels();
    this.el.classList.remove('hidden');
    this.ui.h.panelsChanged?.(true);
    this.render();
    if (this.authed) this.show(this.tab);
  }

  render() {
    $('#adm-login').classList.toggle('hidden', this.authed);
    $('#adm-main').classList.toggle('hidden', !this.authed);
    $('#adm-logout').classList.toggle('hidden', !this.authed);
    if (!this.authed) { $('#adm-pass').value = ''; $('#adm-login-err').textContent = ''; setTimeout(() => $('#adm-pass').focus(), 0); }
  }

  async login() {
    const btn = $('#adm-login-btn'); btn.disabled = true;
    const r = await this.req('login', { password: $('#adm-pass').value });
    btn.disabled = false;
    $('#adm-pass').value = '';
    if (!r.ok) { $('#adm-login-err').textContent = r.error; $('#adm-pass').focus(); return; }
    this.authed = true; this.render(); this.show('online');
  }

  async logout() { await this.req('logout'); this.authed = false; this.render(); }

  show(tab) {
    this.tab = tab;
    $$('#admin-panel [data-adm-tab]').forEach((b) => b.classList.toggle('active', b.dataset.admTab === (tab === 'account' ? 'accounts' : tab)));
    $$('#admin-panel [data-adm-body]').forEach((b) => b.classList.toggle('hidden', b.dataset.admBody !== tab));
    if (tab === 'online') this.loadOnline();
    if (tab === 'accounts') { if (!$('#adm-results').children.length) this.search(); setTimeout(() => $('#adm-search').focus(), 0); }
    if (tab === 'announce') setTimeout(() => $('#adm-announce').focus(), 0);
    this.ui.focusFirst?.(this.el);
  }

  async loadOnline() {
    const r = await this.req('online'); if (!r.ok) return this.status(r.error);
    $('#adm-online-count').textContent = `${r.players.length} playing · ${r.parties} game${r.parties === 1 ? '' : 's'}`;
    $('#adm-online').innerHTML = r.players.length ? r.players.map((p) => `
      <button class="adm-row" data-act="open" data-id="${p.accountId}" type="button">
        <b>${esc(p.name)}</b><span>Lv ${p.level} ${esc(p.cls)}</span><span>${esc(p.where)}</span><span>${p.party === 'solo' ? 'Solo' : `Party ${esc(p.party)}`}</span><span class="g">${fmt(p.gold)}g</span>
      </button>`).join('') : '<p class="muted">Nobody is playing right now.</p>';
  }

  async search() {
    const r = await this.req('search', { q: $('#adm-search').value }); if (!r.ok) return this.status(r.error);
    $('#adm-results').innerHTML = r.accounts.length ? r.accounts.map((a) => `
      <button class="adm-row" data-act="open" data-id="${a.id}" type="button">
        <b>${esc(a.username || a.email || 'Google user')}</b><span>#${a.id}</span><span>${a.google ? 'Google' : 'Password'}</span>
        <span>${a.online ? '<i class="on">● online</i>' : ''}${a.banned ? '<i class="ban">banned</i>' : ''}</span><span class="muted">joined ${ago(a.created)}</span>
      </button>`).join('') : '<p class="muted">No accounts match.</p>';
  }

  async openAccount(id) {
    const r = await this.req('account', { id }); if (!r.ok) return this.status(r.error);
    this.acct = r.account;
    const a = r.account;
    $$('#admin-panel [data-adm-body]').forEach((b) => b.classList.toggle('hidden', b.dataset.admBody !== 'account'));
    this.tab = 'account';
    $('#adm-account').innerHTML = `
      <button class="btn small ghost" data-act="back" type="button">← Accounts</button>
      <h3>${esc(a.username || a.email || 'Google user')} <span class="muted">#${a.id}</span>${a.banned ? ' <i class="ban">banned</i>' : ''}</h3>
      <p class="muted">${a.username ? `Username <b>${esc(a.username)}</b>` : 'No username'}${a.email ? ` · ${esc(a.email)}` : ''} · ${a.google ? 'Google linked' : 'No Google'} · joined ${ago(a.created)}</p>
      <div class="adm-box">
        <h4>Reset password</h4>
        ${a.username ? `<div class="adm-line"><input id="adm-newpass" type="text" maxlength="100" placeholder="New password (leave blank to make one up)" autocomplete="off" /><button class="btn small gold" data-act="reset" type="button">Reset</button></div>
        <div id="adm-pass-result"></div>` : '<p class="muted">This account signs in with Google only, so there is no password to reset.</p>'}
      </div>
      <div class="adm-box">
        <h4>Heroes</h4>
        ${r.chars.length ? r.chars.map((c) => `
          <div class="adm-hero"><div><b>${esc(c.name)}</b> <span class="muted">Lv ${c.level} ${esc(c.cls)} · deepest floor ${c.maxFloor} · played ${ago(c.updated)}</span>${c.online ? ' <i class="on">● online</i>' : ''}</div>
          ${c.online ? `<div class="adm-line"><input id="adm-give-${c.id}" type="number" min="1" value="1000" /><button class="btn small" data-act="give" data-what="gold" data-id="${c.id}" type="button">+ Gold</button><button class="btn small" data-act="give" data-what="xp" data-id="${c.id}" type="button">+ XP</button><button class="btn small" data-act="give" data-what="level" data-id="${c.id}" type="button">+ Levels</button></div>` : ''}
          </div>`).join('') : '<p class="muted">No heroes yet.</p>'}
      </div>
      <div class="adm-box adm-danger">
        <button class="btn small" data-act="kick" type="button">Kick (disconnect)</button>
        ${a.banned ? '<button class="btn small" data-act="unban" type="button">Unban</button>' : '<button class="btn small danger" data-act="ban" type="button">Ban account</button>'}
      </div>`;
    this.ui.focusFirst?.(this.el);
  }

  async resetPassword() {
    const a = this.acct; if (!a) return;
    const pw = $('#adm-newpass').value.trim();
    const r = await this.req('resetPassword', { id: a.id, password: pw || undefined });
    if (!r.ok) return this.status(r.error);
    $('#adm-newpass').value = '';
    $('#adm-pass-result').innerHTML = r.password
      ? `<p class="adm-ok">New password for <b>${esc(r.username)}</b>: <code>${esc(r.password)}</code> <button class="btn small" data-act="copy" data-text="${esc(r.password)}" type="button">Copy</button></p>`
      : `<p class="adm-ok">Password for <b>${esc(r.username)}</b> changed.</p>`;
    this.status('Password reset', 'ok');
  }

  async kick() {
    const r = await this.req('kick', { id: this.acct.id }); if (!r.ok) return this.status(r.error);
    this.status(r.n ? `Disconnected ${r.n} session${r.n === 1 ? '' : 's'}` : 'They weren\'t connected', 'ok');
    this.openAccount(this.acct.id);
  }

  async ban(on) {
    const name = this.acct.username || this.acct.email || `#${this.acct.id}`;
    if (on && !window.confirm(`Ban ${name}? They'll be disconnected and can't sign in until unbanned.`)) return;
    const r = await this.req(on ? 'ban' : 'unban', { id: this.acct.id }); if (!r.ok) return this.status(r.error);
    this.status(on ? `${name} is banned` : `${name} is unbanned`, 'ok');
    this.openAccount(this.acct.id);
  }

  async give(charId, what) {
    const n = Number($(`#adm-give-${charId}`)?.value);
    const r = await this.req('give', { charId, what, n }); if (!r.ok) return this.status(r.error);
    this.status(`Done — now level ${r.level}, ${fmt(r.gold)} gold`, 'ok');
  }

  async announce() {
    const t = $('#adm-announce');
    const r = await this.req('announce', { text: t.value }); if (!r.ok) return this.status(r.error);
    t.value = ''; this.status('Sent to everyone online', 'ok');
  }
}
