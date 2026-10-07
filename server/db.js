// Character storage. Postgres when DATABASE_URL is set (Render), otherwise a JSON file in ./data
// for local play. Both expose the same async API.
import { promises as fs, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { itemLook, MAIL } from '../shared/rules.js';

export const MAX_CHARS = 6;

export async function openDb({ dataDir }) {
  if (process.env.DATABASE_URL) {
    const store = new PgStore(process.env.DATABASE_URL);
    await store.init();
    console.log('  Saves: Postgres');
    return store;
  }
  const store = new FileStore(path.join(dataDir, 'db.json'));
  console.log(`  Saves: ${store.file}`);
  return store;
}

class PgStore {
  constructor(url) { this.url = url; }
  async init() {
    const { default: pg } = await import('pg');
    const local = /localhost|127\.0\.0\.1/.test(this.url);
    // Render's internal URLs (no domain suffix) don't use SSL; external ones require it.
    const host = (this.url.split('@')[1] || '').split(/[/:]/)[0];
    const internal = !host.includes('.');
    const ssl = process.env.PGSSL === '0' || local || internal ? false : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString: this.url, ssl, max: 5 });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        pass TEXT,
        google_sub TEXT UNIQUE,
        email TEXT,
        created TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS characters (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cls TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        data JSONB NOT NULL,
        updated TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
      CREATE TABLE IF NOT EXISTS auctions (
        id SERIAL PRIMARY KEY,
        seller_char INTEGER NOT NULL,
        seller_name TEXT NOT NULL,
        item JSONB NOT NULL,
        price BIGINT NOT NULL,
        slot TEXT, rarity TEXT, req INTEGER, ilvl INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        buyer_name TEXT,
        created TIMESTAMPTZ DEFAULT now(),
        sold_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS auctions_status ON auctions(status, price);
      CREATE INDEX IF NOT EXISTS auctions_seller ON auctions(seller_char, status);
      CREATE TABLE IF NOT EXISTS banks (
        account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mail (
        id SERIAL PRIMARY KEY,
        to_char INTEGER NOT NULL, to_name TEXT NOT NULL,
        from_char INTEGER NOT NULL, from_name TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        items JSONB NOT NULL DEFAULT '[]', gold BIGINT NOT NULL DEFAULT 0,
        created TIMESTAMPTZ DEFAULT now(),
        read BOOLEAN NOT NULL DEFAULT false, returned BOOLEAN NOT NULL DEFAULT false, deleted BOOLEAN NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS mail_to ON mail(to_char, deleted);
    `);
  }
  async q(sql, args) { return (await this.pool.query(sql, args)).rows; }
  async findAccountByUsername(u) { return (await this.q('SELECT * FROM accounts WHERE username = $1', [u.toLowerCase()]))[0] || null; }
  async findAccountByGoogle(sub) { return (await this.q('SELECT * FROM accounts WHERE google_sub = $1', [sub]))[0] || null; }
  async getAccount(id) { return (await this.q('SELECT * FROM accounts WHERE id = $1', [id]))[0] || null; }
  async createAccount({ username, pass = null, googleSub = null, email = null }) {
    return (await this.q('INSERT INTO accounts (username, pass, google_sub, email) VALUES ($1,$2,$3,$4) RETURNING *', [username?.toLowerCase() || null, pass, googleSub, email]))[0];
  }
  // ---- admin console
  async searchAccounts(q, limit = 30) {
    if (/^#?\d+$/.test(q)) return this.q('SELECT * FROM accounts WHERE id = $1', [Number(q.replace('#', ''))]);
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.q(`SELECT DISTINCT a.* FROM accounts a LEFT JOIN characters c ON c.account_id = a.id
      WHERE $1 = '%%' OR a.username LIKE $1 OR lower(a.email) LIKE $1 OR lower(c.name) LIKE $1 ORDER BY a.id DESC LIMIT $2`, [like, limit]);
  }
  async setPassword(id, pass) { await this.q('UPDATE accounts SET pass = $2 WHERE id = $1', [id, pass]); }
  async setBanned(id, banned) { await this.q('UPDATE accounts SET banned = $2 WHERE id = $1', [id, !!banned]); }
  async linkGoogle(id, sub, email) { await this.q('UPDATE accounts SET google_sub = $2, email = COALESCE(email, $3) WHERE id = $1', [id, sub, email]); }
  async listCharacters(aid) {
    return (await this.q('SELECT id, name, cls, level, updated, data FROM characters WHERE account_id = $1 ORDER BY updated DESC', [aid]))
      .map((r) => ({ id: r.id, name: r.name, cls: r.cls, level: r.level, updated: r.updated, look: lookOf(r.data), maxFloor: r.data.maxFloor }));
  }
  async getCharacter(aid, cid) { return (await this.q('SELECT data FROM characters WHERE id = $1 AND account_id = $2', [cid, aid]))[0]?.data || null; }
  async createCharacter(aid, data) {
    return (await this.q('INSERT INTO characters (account_id, name, cls, level, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [aid, data.name, data.cls, data.level, data]))[0].id;
  }
  async saveCharacter(aid, cid, data) {
    await this.q('UPDATE characters SET data = $3, level = $4, updated = now() WHERE id = $1 AND account_id = $2', [cid, aid, data, data.level]);
  }
  async deleteCharacter(aid, cid) { await this.q('DELETE FROM characters WHERE id = $1 AND account_id = $2', [cid, aid]); }

  // ---- auction house. Every state change is one conditional UPDATE, so two buyers can't both win.
  async ahCreate(a) {
    return (await this.q('INSERT INTO auctions (seller_char, seller_name, item, price, slot, rarity, req, ilvl) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [a.sellerChar, a.sellerName, a.item, a.price, a.item.slot, a.item.rarity, a.item.req || 1, a.item.ilvl || 1]))[0].id;
  }
  async ahSearch({ slot, rarity, maxReq, noSlot, sort, offset = 0, limit = 20 }) {
    const where = ["status = 'active'"]; const args = [];
    if (noSlot) { args.push(noSlot); where.push(`slot <> $${args.length}`); }
    if (slot) { args.push(slot); where.push(`slot = $${args.length}`); }
    if (rarity) { args.push(rarity); where.push(`rarity = $${args.length}`); }
    if (maxReq) { args.push(maxReq); where.push(`req <= $${args.length}`); }
    const order = { priceDesc: 'price DESC', newest: 'created DESC', level: 'ilvl DESC, price ASC' }[sort] || 'price ASC';
    args.push(limit + 1, offset);
    const rows = await this.q(`SELECT * FROM auctions WHERE ${where.join(' AND ')} ORDER BY ${order}, id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
    return rows.map(ahRow);
  }
  async ahMine(cid) { return (await this.q("SELECT * FROM auctions WHERE seller_char = $1 AND status IN ('active','sold') ORDER BY created DESC", [cid])).map(ahRow); }
  async ahBuy(id, buyerChar, buyerName) {
    const r = (await this.q("UPDATE auctions SET status = 'sold', buyer_name = $3, sold_at = now() WHERE id = $1 AND status = 'active' AND seller_char <> $2 RETURNING *", [id, buyerChar, buyerName]))[0];
    return r ? ahRow(r) : null;
  }
  async ahUnbuy(id) { await this.q("UPDATE auctions SET status = 'active', buyer_name = NULL, sold_at = NULL WHERE id = $1 AND status = 'sold'", [id]); }
  async ahCancel(id, cid) {
    const r = (await this.q("UPDATE auctions SET status = 'cancelled' WHERE id = $1 AND seller_char = $2 AND status = 'active' RETURNING *", [id, cid]))[0];
    return r ? ahRow(r) : null;
  }
  async ahUncancel(id) { await this.q("UPDATE auctions SET status = 'active' WHERE id = $1 AND status = 'cancelled'", [id]); }
  async ahCollect(cid) { return (await this.q("UPDATE auctions SET status = 'collected' WHERE seller_char = $1 AND status = 'sold' RETURNING *", [cid])).map(ahRow); }

  // One transaction: the hero and the bank / a letter change together or not at all, so an item
  // can never be in two places (or none) if the server stops halfway.
  async tx(fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(async (sql, args) => (await c.query(sql, args)).rows);
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  async heroBasic(cid) {
    const r = (await this.q('SELECT id, account_id, name, cls, level FROM characters WHERE id = $1', [cid]))[0];
    return r ? { id: r.id, accountId: r.account_id, name: r.name, cls: r.cls, level: r.level } : null;
  }
  async heroesNamed(name, limit = 8) {
    return (await this.q('SELECT id, account_id, name, cls, level, updated FROM characters WHERE lower(name) = lower($1) ORDER BY updated DESC LIMIT $2', [name, limit]))
      .map((r) => ({ id: r.id, accountId: r.account_id, name: r.name, cls: r.cls, level: r.level, updated: r.updated }));
  }

  // ---- bank (one per account)
  async bankGet(aid) { return (await this.q('SELECT data FROM banks WHERE account_id = $1', [aid]))[0]?.data || null; }
  async bankSave(aid, bank, cid, charData) {
    await this.tx(async (q) => {
      await q('INSERT INTO banks (account_id, data) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET data = $2', [aid, bank]);
      if (charData) await q('UPDATE characters SET data = $3, level = $4, updated = now() WHERE id = $1 AND account_id = $2', [cid, aid, charData, charData.level]);
    });
  }

  // ---- mail
  async mailSweep() {
    // Unclaimed letters with something attached go back to the sender after MAIL.keepDays (or at
    // once if the recipient was deleted); old empty letters are thrown away. Returned letters stay.
    await this.q(`UPDATE mail SET to_char = from_char, to_name = from_name, from_char = to_char, from_name = to_name, returned = true, read = false, created = now()
      WHERE NOT deleted AND NOT returned AND (jsonb_array_length(items) > 0 OR gold > 0)
      AND (created < now() - make_interval(days => $1) OR NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = mail.to_char))`, [MAIL.keepDays]);
    await this.q("UPDATE mail SET deleted = true WHERE NOT deleted AND jsonb_array_length(items) = 0 AND gold = 0 AND created < now() - make_interval(days => $1)", [MAIL.keepDays]);
  }
  async mailSend(m, aid, cid, charData) {
    return this.tx(async (q) => {
      const id = (await q('INSERT INTO mail (to_char, to_name, from_char, from_name, subject, body, items, gold) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [m.toChar, m.toName, m.fromChar, m.fromName, m.subject, m.body, JSON.stringify(m.items), m.gold]))[0].id;
      await q('UPDATE characters SET data = $3, level = $4, updated = now() WHERE id = $1 AND account_id = $2', [cid, aid, charData, charData.level]);
      return id;
    });
  }
  async mailInbox(cid, limit = MAIL.inboxMax) {
    return (await this.q('SELECT * FROM mail WHERE to_char = $1 AND NOT deleted ORDER BY created DESC LIMIT $2', [cid, limit])).map(mailRow);
  }
  async mailUnread(cid) { return Number((await this.q('SELECT count(*) AS n FROM mail WHERE to_char = $1 AND NOT deleted AND NOT read', [cid]))[0].n); }
  // Take attachments: `fn(letter)` moves them onto the hero and returns what's left on the letter.
  async mailTake(id, cid, aid, fn) {
    return this.tx(async (q) => {
      const r = (await q('SELECT * FROM mail WHERE id = $1 AND to_char = $2 AND NOT deleted FOR UPDATE', [id, cid]))[0];
      if (!r) return { error: 'That letter is gone' };
      const out = fn(mailRow(r));
      if (out.error) return out;
      await q('UPDATE mail SET items = $2, gold = $3, read = true WHERE id = $1', [id, JSON.stringify(out.items), out.gold]);
      await q('UPDATE characters SET data = $3, level = $4, updated = now() WHERE id = $1 AND account_id = $2', [cid, aid, out.charData, out.charData.level]);
      return out;
    });
  }
  async mailMarkRead(id, cid) { await this.q('UPDATE mail SET read = true WHERE id = $1 AND to_char = $2', [id, cid]); }
  async mailDelete(id, cid) {
    return (await this.q("UPDATE mail SET deleted = true WHERE id = $1 AND to_char = $2 AND NOT deleted AND jsonb_array_length(items) = 0 AND gold = 0 RETURNING id", [id, cid])).length > 0;
  }
  async mailReturn(id, cid) {
    const r = (await this.q(`UPDATE mail SET to_char = from_char, to_name = from_name, from_char = to_char, from_name = to_name, returned = true, read = false, created = now()
      WHERE id = $1 AND to_char = $2 AND NOT deleted AND NOT returned RETURNING *`, [id, cid]))[0];
    return r ? mailRow(r) : null;
  }
}

function mailRow(r) {
  return { id: r.id, toChar: r.to_char, toName: r.to_name, fromChar: r.from_char, fromName: r.from_name, subject: r.subject, body: r.body,
    items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items || [], gold: Number(r.gold) || 0, created: r.created, read: !!r.read, returned: !!r.returned };
}

function ahRow(r) {
  return { id: r.id, sellerChar: r.seller_char, seller: r.seller_name, item: r.item, price: Number(r.price), status: r.status, buyer: r.buyer_name, created: r.created, soldAt: r.sold_at };
}

class FileStore {
  constructor(file) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true });
    this.d = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { seq: 1, accounts: [], characters: [] };
    this.d.auctions ||= [];
    this.d.banks ||= {};
    this.d.mail ||= [];
    this.writing = null; this.pending = false;
  }
  async flush() {
    if (this.writing) { this.pending = true; return this.writing; }
    this.writing = (async () => {
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.d));
      await fs.rename(tmp, this.file);
    })();
    try { await this.writing; } finally {
      this.writing = null;
      if (this.pending) { this.pending = false; await this.flush(); }
    }
  }
  id() { return this.d.seq++; }
  async findAccountByUsername(u) { return this.d.accounts.find((a) => a.username === u.toLowerCase()) || null; }
  async findAccountByGoogle(sub) { return this.d.accounts.find((a) => a.google_sub === sub) || null; }
  async getAccount(id) { return this.d.accounts.find((a) => a.id === id) || null; }
  async createAccount({ username, pass = null, googleSub = null, email = null }) {
    const a = { id: this.id(), username: username?.toLowerCase() || null, pass, google_sub: googleSub, email, created: new Date().toISOString() };
    this.d.accounts.push(a); await this.flush(); return a;
  }
  // ---- admin console
  async searchAccounts(q, limit = 30) {
    if (/^#?\d+$/.test(q)) return this.d.accounts.filter((a) => a.id === Number(q.replace('#', '')));
    const t = q.toLowerCase();
    const has = (v) => !!v && String(v).toLowerCase().includes(t);
    return this.d.accounts.filter((a) => !t || has(a.username) || has(a.email) || this.d.characters.some((c) => c.account_id === a.id && has(c.data.name)))
      .sort((a, b) => b.id - a.id).slice(0, limit);
  }
  async setPassword(id, pass) { const a = await this.getAccount(id); if (a) { a.pass = pass; await this.flush(); } }
  async setBanned(id, banned) { const a = await this.getAccount(id); if (a) { a.banned = !!banned; await this.flush(); } }
  async linkGoogle(id, sub, email) { const a = await this.getAccount(id); if (a) { a.google_sub = sub; a.email ||= email; await this.flush(); } }
  async listCharacters(aid) {
    return this.d.characters.filter((c) => c.account_id === aid).sort((a, b) => (b.updated > a.updated ? 1 : -1))
      .map((c) => ({ id: c.id, name: c.data.name, cls: c.data.cls, level: c.data.level, updated: c.updated, look: lookOf(c.data), maxFloor: c.data.maxFloor }));
  }
  async getCharacter(aid, cid) {
    const c = this.d.characters.find((x) => x.id === cid && x.account_id === aid);
    return c ? JSON.parse(JSON.stringify(c.data)) : null;
  }
  async createCharacter(aid, data) {
    const c = { id: this.id(), account_id: aid, data, updated: new Date().toISOString() };
    this.d.characters.push(c); await this.flush(); return c.id;
  }
  async saveCharacter(aid, cid, data) {
    const c = this.d.characters.find((x) => x.id === cid && x.account_id === aid);
    if (!c) return;
    c.data = JSON.parse(JSON.stringify(data)); c.updated = new Date().toISOString();
    await this.flush();
  }
  async deleteCharacter(aid, cid) {
    this.d.characters = this.d.characters.filter((x) => !(x.id === cid && x.account_id === aid));
    await this.flush();
  }

  // ---- auction house (same API as PgStore; JS is single-threaded so these are atomic)
  async ahCreate(a) {
    const r = { id: this.id(), seller_char: a.sellerChar, seller_name: a.sellerName, item: JSON.parse(JSON.stringify(a.item)), price: a.price, slot: a.item.slot, rarity: a.item.rarity, req: a.item.req || 1, ilvl: a.item.ilvl || 1, status: 'active', created: new Date().toISOString() };
    this.d.auctions.push(r); await this.flush(); return r.id;
  }
  async ahSearch({ slot, rarity, maxReq, noSlot, sort, offset = 0, limit = 20 }) {
    const rows = this.d.auctions.filter((a) => a.status === 'active' && (!noSlot || a.slot !== noSlot) && (!slot || a.slot === slot) && (!rarity || a.rarity === rarity) && (!maxReq || a.req <= maxReq));
    const cmp = { priceDesc: (a, b) => b.price - a.price, newest: (a, b) => (b.created > a.created ? 1 : -1), level: (a, b) => b.ilvl - a.ilvl || a.price - b.price }[sort] || ((a, b) => a.price - b.price);
    return rows.sort((a, b) => cmp(a, b) || b.id - a.id).slice(offset, offset + limit + 1).map((r) => ahRow(JSON.parse(JSON.stringify(r))));
  }
  async ahMine(cid) { return this.d.auctions.filter((a) => a.seller_char === cid && (a.status === 'active' || a.status === 'sold')).reverse().map(ahRow); }
  async ahBuy(id, buyerChar, buyerName) {
    const r = this.d.auctions.find((a) => a.id === id && a.status === 'active' && a.seller_char !== buyerChar);
    if (!r) return null;
    r.status = 'sold'; r.buyer_name = buyerName; r.sold_at = new Date().toISOString(); await this.flush();
    return ahRow(JSON.parse(JSON.stringify(r)));
  }
  async ahUnbuy(id) { const r = this.d.auctions.find((a) => a.id === id && a.status === 'sold'); if (r) { r.status = 'active'; r.buyer_name = null; r.sold_at = null; await this.flush(); } }
  async ahCancel(id, cid) {
    const r = this.d.auctions.find((a) => a.id === id && a.seller_char === cid && a.status === 'active');
    if (!r) return null;
    r.status = 'cancelled'; await this.flush(); return ahRow(JSON.parse(JSON.stringify(r)));
  }
  async ahUncancel(id) { const r = this.d.auctions.find((a) => a.id === id && a.status === 'cancelled'); if (r) { r.status = 'active'; await this.flush(); } }
  async ahCollect(cid) {
    const rows = this.d.auctions.filter((a) => a.seller_char === cid && a.status === 'sold');
    rows.forEach((r) => { r.status = 'collected'; });
    if (rows.length) await this.flush();
    return rows.map(ahRow);
  }

  // ---- heroes by id / name (mail recipients)
  async heroBasic(cid) {
    const c = this.d.characters.find((x) => x.id === cid);
    return c ? { id: c.id, accountId: c.account_id, name: c.data.name, cls: c.data.cls, level: c.data.level } : null;
  }
  async heroesNamed(name, limit = 8) {
    const n = name.toLowerCase();
    return this.d.characters.filter((c) => c.data.name.toLowerCase() === n).sort((a, b) => (b.updated > a.updated ? 1 : -1)).slice(0, limit)
      .map((c) => ({ id: c.id, accountId: c.account_id, name: c.data.name, cls: c.data.cls, level: c.data.level, updated: c.updated }));
  }
  setChar(aid, cid, data) {
    const c = this.d.characters.find((x) => x.id === cid && x.account_id === aid);
    if (c) { c.data = clone(data); c.updated = new Date().toISOString(); }
  }

  // ---- bank (writes to the bank and the hero land in the same file write)
  async bankGet(aid) { const b = this.d.banks[aid]; return b ? clone(b) : null; }
  async bankSave(aid, bank, cid, charData) { this.d.banks[aid] = clone(bank); if (charData) this.setChar(aid, cid, charData); await this.flush(); }

  // ---- mail
  async mailSweep() {
    const cutoff = Date.now() - MAIL.keepDays * 864e5;
    let changed = false;
    for (const m of this.d.mail) {
      if (m.deleted) continue;
      const has = m.items.length > 0 || m.gold > 0;
      const old = Date.parse(m.created) < cutoff;
      if (has && !m.returned && (old || !this.d.characters.some((c) => c.id === m.to_char))) { swapMail(m); changed = true; }
      else if (!has && old) { m.deleted = true; changed = true; }
    }
    if (changed) await this.flush();
  }
  async mailSend(m, aid, cid, charData) {
    const r = { id: this.id(), to_char: m.toChar, to_name: m.toName, from_char: m.fromChar, from_name: m.fromName, subject: m.subject, body: m.body, items: clone(m.items), gold: m.gold, created: new Date().toISOString(), read: false, returned: false, deleted: false };
    this.d.mail.push(r); this.setChar(aid, cid, charData); await this.flush(); return r.id;
  }
  async mailInbox(cid, limit = MAIL.inboxMax) {
    return this.d.mail.filter((m) => m.to_char === cid && !m.deleted).sort((a, b) => (b.created > a.created ? 1 : b.created < a.created ? -1 : b.id - a.id)).slice(0, limit).map((m) => mailRow(clone(m)));
  }
  async mailUnread(cid) { return this.d.mail.filter((m) => m.to_char === cid && !m.deleted && !m.read).length; }
  async mailTake(id, cid, aid, fn) {
    const m = this.d.mail.find((x) => x.id === id && x.to_char === cid && !x.deleted);
    if (!m) return { error: 'That letter is gone' };
    const out = fn(mailRow(clone(m)));
    if (out.error) return out;
    m.items = clone(out.items); m.gold = out.gold; m.read = true;
    this.setChar(aid, cid, out.charData);
    await this.flush();
    return out;
  }
  async mailMarkRead(id, cid) { const m = this.d.mail.find((x) => x.id === id && x.to_char === cid); if (m && !m.read) { m.read = true; await this.flush(); } }
  async mailDelete(id, cid) {
    const m = this.d.mail.find((x) => x.id === id && x.to_char === cid && !x.deleted && !x.items.length && !x.gold);
    if (!m) return false;
    m.deleted = true; await this.flush(); return true;
  }
  async mailReturn(id, cid) {
    const m = this.d.mail.find((x) => x.id === id && x.to_char === cid && !x.deleted && !x.returned);
    if (!m) return null;
    swapMail(m); await this.flush(); return mailRow(clone(m));
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));
function swapMail(m) {
  [m.to_char, m.from_char] = [m.from_char, m.to_char]; [m.to_name, m.from_name] = [m.from_name, m.to_name];
  m.returned = true; m.read = false; m.created = new Date().toISOString();
}

// What the character looks like, for the select screen.
export function lookOf(ch) {
  const e = ch.equip || {};
  return { weapon: itemLook(e.weapon), offhand: itemLook(e.offhand), head: itemLook(e.head), chest: itemLook(e.chest), hands: itemLook(e.hands), feet: itemLook(e.feet) };
}
