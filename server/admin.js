// In-game admin console. A player types /console in chat, enters ADMIN_PASSWORD (set as an
// environment variable on the server), and that one connection gets admin tools until it
// disconnects. Every admin action is written to the server log.
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { hashPassword, validPassword, rateLimited } from './auth.js';
import { parties } from './party.js';
import { xpToNext } from '../shared/rules.js';

const MIN_LEN = 8;

export function adminConfigured() { return String(process.env.ADMIN_PASSWORD || '').length >= MIN_LEN; }

function passwordMatches(pw) {
  const want = createHash('sha256').update(String(process.env.ADMIN_PASSWORD || '')).digest();
  const got = createHash('sha256').update(String(pw || '')).digest();
  return timingSafeEqual(want, got);
}

export function clientIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  return (typeof xff === 'string' && xff.split(',')[0].trim()) || socket.handshake.address || '?';
}

// Everyone currently playing, with where they are.
function onlinePlayers() {
  const out = [];
  for (const p of parties.values()) {
    for (const m of p.members.values()) {
      const z = p.zone?.spec;
      out.push({ accountId: m.accountId, charId: m.charId, name: m.char.name, cls: m.char.cls, level: m.char.level, gold: m.char.gold, party: p.solo ? 'solo' : p.code, where: !z ? '…' : z.kind === 'town' ? 'Town' : `Floor ${z.floor}` });
    }
  }
  return out;
}

function findMember(charId) {
  for (const p of parties.values()) for (const m of p.members.values()) if (m.charId === charId) return m;
  return null;
}

function socketsOf(io, accountId) { return [...io.of('/').sockets.values()].filter((s) => s.data.accountId === accountId); }

function kickAccount(io, accountId, reason) {
  const list = socketsOf(io, accountId);
  for (const s of list) { s.emit('kicked', { reason }); s.disconnect(true); }
  return list.length;
}

function publicAccount(a, extra = {}) {
  return { id: a.id, username: a.username, email: a.email || null, google: !!a.google_sub, hasPassword: !!a.pass, banned: !!a.banned, created: a.created, ...extra };
}

// Returns the handler for the 'admin' socket event.
export function adminHandler({ io, db, socket }) {
  const log = (what) => console.log(`[admin] account ${socket.data.accountId} (${clientIp(socket)}): ${what}`);
  return async (d = {}, cb) => {
    if (typeof cb !== 'function') return;
    const ok = (extra = {}) => cb({ ok: true, ...extra });
    const err = (error) => cb({ ok: false, error });
    try {
      const op = String(d.op || '');
      if (op === 'login') {
        if (!adminConfigured()) return err(`The admin console is off. Set ADMIN_PASSWORD (${MIN_LEN}+ characters) on the server to turn it on.`);
        if (rateLimited(`admin:${clientIp(socket)}`, 5, 10 * 60_000)) return err('Too many tries. Wait 10 minutes.');
        if (!passwordMatches(d.password)) { log('FAILED login'); return err('Wrong admin password'); }
        socket.data.admin = true;
        log('logged in');
        return ok();
      }
      if (!socket.data.admin) return err('Not logged in to the console');

      if (op === 'logout') { socket.data.admin = false; log('logged out'); return ok(); }

      if (op === 'online') return ok({ players: onlinePlayers(), parties: parties.size });

      if (op === 'search') {
        const rows = await db.searchAccounts(String(d.q || '').trim().slice(0, 60), 30);
        const live = new Set(onlinePlayers().map((p) => p.accountId));
        return ok({ accounts: rows.map((a) => publicAccount(a, { online: live.has(a.id) })) });
      }

      const id = Number(d.id);
      const acct = Number.isInteger(id) ? await db.getAccount(id) : null;
      if (['account', 'resetPassword', 'kick', 'ban', 'unban'].includes(op) && !acct) return err('Account not found');

      if (op === 'account') {
        const chars = await db.listCharacters(id);
        const live = new Set(onlinePlayers().filter((p) => p.accountId === id).map((p) => p.charId));
        return ok({ account: publicAccount(acct), chars: chars.map((c) => ({ id: c.id, name: c.name, cls: c.cls, level: c.level, maxFloor: c.maxFloor || 1, updated: c.updated, online: live.has(c.id) })) });
      }

      if (op === 'resetPassword') {
        if (!acct.username) return err('This account only uses Google sign-in, so it has no password to reset');
        const generated = !d.password;
        const pw = generated ? randomBytes(6).toString('base64url') : String(d.password);
        if (!validPassword(pw)) return err('Passwords need at least 6 characters');
        await db.setPassword(id, await hashPassword(pw));
        log(`reset password for "${acct.username}" (#${id})`);
        return ok({ password: generated ? pw : null, username: acct.username });
      }

      if (op === 'kick') {
        const n = kickAccount(io, id, String(d.reason || 'You were disconnected by an admin').slice(0, 140));
        log(`kicked #${id} (${n} connection${n === 1 ? '' : 's'})`);
        return ok({ n });
      }

      if (op === 'ban' || op === 'unban') {
        if (op === 'ban' && id === socket.data.accountId) return err('You can\'t ban yourself');
        await db.setBanned(id, op === 'ban');
        if (op === 'ban') kickAccount(io, id, 'This account has been banned');
        log(`${op}ned #${id} (${acct.username || acct.email || 'google'})`);
        return ok();
      }

      if (op === 'announce') {
        const text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return err('Type a message first');
        io.emit('announce', { text });
        log(`announced: ${text}`);
        return ok();
      }

      if (op === 'give') {
        const m = findMember(Number(d.charId));
        if (!m?.party) return err('That hero isn\'t online (gold and XP can only be given to heroes in a game)');
        const n = Math.max(0, Math.min(10_000_000, Math.floor(Number(d.n) || 0)));
        if (!n) return err('Enter an amount');
        if (d.what === 'gold') { m.char.gold += n; m.dirty = true; m.party.sendChar(m.pid); }
        else if (d.what === 'xp') m.party.grantXp(m.pid, n);
        else if (d.what === 'level') { let need = -(m.char.xp || 0); for (let i = 0; i < Math.min(n, 99); i++) need += xpToNext(m.char.level + i); m.party.grantXp(m.pid, Math.max(1, need)); }
        else return err('Unknown reward');
        m.socket.emit('msg', { text: `An admin gave you ${n.toLocaleString()} ${d.what === 'level' ? `level${n === 1 ? '' : 's'}` : d.what === 'xp' ? 'XP' : 'gold'}`, kind: 'info' });
        log(`gave ${n} ${d.what} to ${m.char.name} (char #${m.charId})`);
        return ok({ level: m.char.level, gold: m.char.gold });
      }

      return err('Unknown command');
    } catch (e) { console.error('admin', e); err('Server error'); }
  };
}
