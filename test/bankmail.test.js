// Bank (shared per account) and mail (items + gold between heroes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { generateTown } from '../shared/map.js';
import { BANK, postage } from '../shared/rules.js';

const call = (s, ev, d) => new Promise((r) => (d === undefined ? s.emit(ev, r) : s.emit(ev, d, r)));
const wait = (s, ev) => new Promise((r) => s.once(ev, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('bank and mail', async () => {
  process.env.DEV_CMDS = '1';
  const { startServer } = await import('../server/index.js');
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sc-bm-'));
  const { server } = await startServer({ port: 0, dataDir });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const town = generateTown();
  const at = (id) => town.npcs.find((n) => n.id === id);
  const socks = [];

  async function account(user) { return (await post('/api/register', { username: user, password: 'hunter22' })).token; }
  async function hero(token, name, cls = 'knight') {
    const s = connect(base, { auth: { token }, transports: ['websocket'] });
    socks.push(s);
    await wait(s, 'connect');
    const c = await call(s, 'createChar', { name, cls });
    const notice = wait(s, 'mailNotice');
    const play = await call(s, 'play', { charId: c.id, mode: 'solo' });
    s.charId = c.id;
    s.char = play.char;
    s.on('char', (ch) => { s.char = ch.char || ch; });
    s.notice = await notice;
    return s;
  }
  const goTo = async (s, id) => { const n = at(id); await call(s, 'dev', { cmd: 'tp', x: n.x + 1, y: n.y + 1 }); await sleep(120); };
  const item = async (s, base = 'sword') => { await call(s, 'dev', { cmd: 'item', base, rarity: 'rare', ilvl: 3 }); await sleep(120); return s.char.inv.findIndex(Boolean); };

  try {
    const tokA = await account('dadacct');
    const a1 = await hero(tokA, 'Dadfirst');
    const a2 = await hero(tokA, 'Dadsecond', 'druid');
    const b = await hero(await account('kidacct'), 'Kiddo');
    assert.equal(b.notice.unread, 0);

    // ---- bank: only at the banker
    assert.match((await call(a1, 'bank', { op: 'open' })).error, /banker/);
    await goTo(a1, 'banker');
    let r = await call(a1, 'bank', { op: 'open' });
    assert.equal(r.bank.tabs, 1); assert.equal(r.bank.slots.length, BANK.tabSize);
    const idx = await item(a1, 'axe');
    const axe = a1.char.inv[idx];
    r = await call(a1, 'bank', { op: 'deposit', idx });
    assert.ok(r.ok, r.error); await sleep(100);
    assert.equal(a1.char.inv[idx], null, 'left the pack');
    assert.equal(r.bank.slots.filter(Boolean)[0].name, axe.name);
    // gold in and out
    await call(a1, 'dev', { cmd: 'gold', n: 8000 }); await sleep(100);
    const g0 = a1.char.gold;
    r = await call(a1, 'bank', { op: 'depositGold', n: 3000 });
    assert.equal(r.bank.gold, 3000); await sleep(100); assert.equal(a1.char.gold, g0 - 3000);
    assert.match((await call(a1, 'bank', { op: 'withdrawGold', n: 9999 })).error, /doesn't hold/);
    // buy a tab
    r = await call(a1, 'bank', { op: 'buyTab' });
    assert.ok(r.ok, r.error); assert.equal(r.bank.tabs, 2); assert.equal(r.bank.slots.length, BANK.tabSize * 2);

    // the other hero on the same account sees the same bank
    await goTo(a2, 'banker');
    r = await call(a2, 'bank', { op: 'open' });
    assert.equal(r.bank.gold, 3000); assert.equal(r.bank.tabs, 2);
    const slot = r.bank.slots.findIndex(Boolean);
    r = await call(a2, 'bank', { op: 'withdraw', slot }); await sleep(100);
    assert.ok(r.ok, r.error);
    assert.ok(a2.char.inv.some((x) => x?.name === axe.name), 'alt has the axe');
    r = await call(a2, 'bank', { op: 'withdrawGold', n: 1000 });
    assert.equal(r.bank.gold, 2000);
    // a different account has its own bank
    await goTo(b, 'banker');
    assert.equal((await call(b, 'bank', { op: 'open' })).bank.gold, 0);

    // ---- mail
    await goTo(a2, 'mailbox'); await goTo(b, 'mailbox');
    const look = await call(a2, 'mail', { op: 'lookup', name: 'kiddo' });
    assert.equal(look.heroes.length, 1); assert.equal(look.heroes[0].name, 'Kiddo');
    const contacts = await call(a2, 'mail', { op: 'contacts' });
    assert.ok(contacts.heroes.some((h) => h.name === 'Dadfirst' && h.why === 'yours'));
    const axeIdx = a2.char.inv.findIndex((x) => x?.name === axe.name);
    const gold0 = a2.char.gold;
    const gotNotice = wait(b, 'mailNotice');
    r = await call(a2, 'mail', { op: 'send', to: look.heroes[0].id, subject: 'For you', body: 'Here is an axe\nand some gold', items: [axeIdx], gold: 250 });
    assert.ok(r.ok, r.error); await sleep(100);
    assert.equal(a2.char.gold, gold0 - 250 - postage(1), 'gold and postage paid');
    assert.equal(a2.char.inv[axeIdx], null);
    assert.equal((await gotNotice).unread, 1);
    // sending more than you have fails and changes nothing
    assert.match((await call(a2, 'mail', { op: 'send', to: b.charId, subject: 'x', gold: 10 ** 8 })).error, /You need/);

    let inbox = await call(b, 'mail', { op: 'inbox' });
    assert.equal(inbox.rows.length, 1); assert.equal(inbox.unread, 1);
    const letter = inbox.rows[0];
    assert.equal(letter.from, 'Dadsecond'); assert.equal(letter.body, 'Here is an axe\nand some gold'); assert.equal(letter.gold, 250);
    assert.match((await call(b, 'mail', { op: 'delete', id: letter.id })).error, /Take/);
    const bGold = b.char.gold;
    r = await call(b, 'mail', { op: 'take', id: letter.id, all: true }); await sleep(100);
    assert.ok(r.ok, r.error);
    assert.ok(b.char.inv.some((x) => x?.name === axe.name)); assert.equal(b.char.gold, bGold + 250);
    assert.match((await call(b, 'mail', { op: 'take', id: letter.id, all: true })).error, /Nothing/);
    assert.ok((await call(b, 'mail', { op: 'delete', id: letter.id })).ok);
    assert.equal((await call(b, 'mail', { op: 'inbox' })).rows.length, 0);

    // a plain letter, no items or gold
    r = await call(b, 'mail', { op: 'send', to: a2.charId, subject: 'Hi', body: 'Just saying hi' });
    assert.ok(r.ok, r.error);
    inbox = await call(a2, 'mail', { op: 'inbox' });
    assert.equal(inbox.rows[0].body, 'Just saying hi'); assert.equal(inbox.rows[0].items.length, 0);
    assert.ok((await call(a2, 'mail', { op: 'delete', id: inbox.rows[0].id })).ok);

    // send back: the letter returns to the sender with its attachments
    const kidItem = b.char.inv.findIndex((x) => x?.name === axe.name);
    r = await call(b, 'mail', { op: 'send', to: a1.charId, subject: 'Thanks', items: [kidItem] });
    assert.ok(r.ok, r.error);
    await goTo(a1, 'mailbox');
    inbox = await call(a1, 'mail', { op: 'inbox' });
    r = await call(a1, 'mail', { op: 'return', id: inbox.rows[0].id });
    assert.ok(r.ok, r.error);
    inbox = await call(b, 'mail', { op: 'inbox' });
    assert.equal(inbox.rows.length, 1); assert.ok(inbox.rows[0].returned); assert.equal(inbox.rows[0].items[0].name, axe.name);

    // everything is on disk: the bank and the returned letter, and the heroes' packs match
    await sleep(300);
    const { openDb } = await import('../server/db.js');
    const disk = await openDb({ dataDir });
    const aid = (await disk.findAccountByUsername('dadacct')).id;
    assert.equal((await disk.bankGet(aid)).gold, 2000);
    const kidMail = await disk.mailInbox(b.charId);
    assert.equal(kidMail[0].items[0].name, axe.name);
    const kidAcct = (await disk.findAccountByUsername('kidacct')).id;
    const kidSaved = await disk.getCharacter(kidAcct, b.charId);
    assert.ok(!kidSaved.inv.some((x) => x?.name === axe.name), 'the axe is on the letter, not also in the pack');
  } finally {
    socks.forEach((s) => s.disconnect());
    server.close(); setTimeout(() => process.exit(0), 300).unref();
  }
});
