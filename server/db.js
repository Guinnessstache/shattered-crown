// Character storage. Postgres when DATABASE_URL is set (Render), otherwise a JSON file in ./data
// for local play. Both expose the same async API.
import { promises as fs, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { itemLook } from '../shared/rules.js';

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
  async ahSearch({ slot, rarity, maxReq, sort, offset = 0, limit = 20 }) {
    const where = ["status = 'active'"]; const args = [];
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
  async ahSearch({ slot, rarity, maxReq, sort, offset = 0, limit = 20 }) {
    const rows = this.d.auctions.filter((a) => a.status === 'active' && (!slot || a.slot === slot) && (!rarity || a.rarity === rarity) && (!maxReq || a.req <= maxReq));
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
}

// What the character looks like, for the select screen.
export function lookOf(ch) {
  const e = ch.equip || {};
  return { weapon: itemLook(e.weapon), offhand: itemLook(e.offhand), head: itemLook(e.head), chest: itemLook(e.chest), hands: itemLook(e.hands), feet: itemLook(e.feet) };
}
