// Character storage. Postgres when DATABASE_URL is set (Render), otherwise a JSON file in ./data
// for local play. Both expose the same async API.
import { promises as fs, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
    `);
  }
  async q(sql, args) { return (await this.pool.query(sql, args)).rows; }
  async findAccountByUsername(u) { return (await this.q('SELECT * FROM accounts WHERE username = $1', [u.toLowerCase()]))[0] || null; }
  async findAccountByGoogle(sub) { return (await this.q('SELECT * FROM accounts WHERE google_sub = $1', [sub]))[0] || null; }
  async getAccount(id) { return (await this.q('SELECT * FROM accounts WHERE id = $1', [id]))[0] || null; }
  async createAccount({ username, pass = null, googleSub = null, email = null }) {
    return (await this.q('INSERT INTO accounts (username, pass, google_sub, email) VALUES ($1,$2,$3,$4) RETURNING *', [username?.toLowerCase() || null, pass, googleSub, email]))[0];
  }
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
}

class FileStore {
  constructor(file) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true });
    this.d = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { seq: 1, accounts: [], characters: [] };
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
}

// What the character looks like, for the select screen.
export function lookOf(ch) {
  const e = ch.equip || {};
  return {
    weapon: e.weapon ? { kind: e.weapon.kind, tier: e.weapon.tier, rarity: e.weapon.rarity } : null,
    offhand: e.offhand ? { kind: e.offhand.kind, tier: e.offhand.tier, rarity: e.offhand.rarity } : null,
    head: e.head ? { tier: e.head.tier, rarity: e.head.rarity } : null,
    chest: e.chest ? { tier: e.chest.tier, rarity: e.chest.rarity } : null,
    hands: e.hands ? { tier: e.hands.tier } : null,
    feet: e.feet ? { tier: e.feet.tier } : null,
  };
}
