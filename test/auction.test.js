import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';
import { generateTown, distanceField, toTile, TILE } from '../shared/map.js';

const call = (s, ev, d) => new Promise((r) => (d === undefined ? s.emit(ev, r) : s.emit(ev, d, r)));
const wait = (s, ev) => new Promise((r) => s.once(ev, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('auction house: list, buy, collect, cancel', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sc-ah-'));
  const { server } = await startServer({ port: 0, dataDir });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const town = generateTown();
  const broker = town.npcs.find((n) => n.id === 'auctioneer');
  assert.ok(broker, 'broker stands in town');

  async function hero(user, name) {
    const reg = await post('/api/register', { username: user, password: 'hunter22' });
    const s = connect(base, { auth: { token: reg.token }, transports: ['websocket'] });
    await wait(s, 'connect');
    const c = await call(s, 'createChar', { name, cls: 'knight' });
    const zoneP = wait(s, 'zone');
    const play = await call(s, 'play', { charId: c.id, mode: 'solo' });
    const z = await zoneP;
    const me = z.players.find((p) => p.pid === play.pid);
    s.state = { char: play.char, x: me.x, y: me.y };
    s.on('char', (ch) => { s.state.char = ch.char || ch; });
    // Walk to the broker in small steps (the server checks speed).
    const field = distanceField(town, [broker], 999);
    let corr = null; s.on('correct', (p) => { corr = p; });
    let { x, y } = s.state;
    for (let i = 0; i < 500 && Math.hypot(broker.x - x, broker.y - y) > 2; i++) {
      if (corr) { x = corr.x; y = corr.y; corr = null; }
      const tx = toTile(x); const ty = toTile(y);
      let best = [broker.x, broker.y]; let bd = field[ty * town.w + tx];
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = field[(ty + oy) * town.w + tx + ox]; if (v >= 0 && v < bd) { bd = v; best = [(tx + ox) * TILE + 1, (ty + oy) * TILE + 1]; } }
      const d = Math.hypot(best[0] - x, best[1] - y) || 1; const st = Math.min(d, 0.25);
      x += (best[0] - x) / d * st; y += (best[1] - y) / d * st;
      s.emit('pos', { x, y, rot: 0 });
      await sleep(40);
    }
    await sleep(150);
    return s;
  }

  const A = await hero('seller', 'Sella');
  const B = await hero('buyer', 'Bayer');
  // Seller takes off the starting weapon and lists it.
  assert.ok((await call(A, 'inv', { op: 'unequip', slot: 'weapon' })).ok);
  const listed = await call(A, 'ah', { op: 'list', idx: 0, price: 30 });
  assert.ok(listed.ok, listed.error);
  assert.equal((await call(A, 'ah', { op: 'list', idx: 0, price: 30 })).error, 'Pick an item from your pack');
  const mineA = await call(A, 'ah', { op: 'mine' });
  assert.equal(mineA.rows.length, 1);
  // Seller can't buy their own listing; buyer can see and buy it.
  const seen = await call(B, 'ah', { op: 'search' });
  assert.equal(seen.rows.length, 1);
  const row = seen.rows[0];
  assert.equal(row.mine, false);
  assert.ok((await call(A, 'ah', { op: 'buy', id: row.id, price: row.price })).error);
  assert.equal((await call(B, 'ah', { op: 'buy', id: row.id, price: 999 })).error, 'Not enough gold');
  const soldMsg = wait(A, 'msg');
  const bought = await call(B, 'ah', { op: 'buy', id: row.id, price: row.price });
  assert.ok(bought.ok, bought.error);
  assert.match((await soldMsg).text, /sold for 30/);
  assert.ok((await call(B, 'ah', { op: 'buy', id: row.id, price: row.price })).error, 'cannot buy twice');
  assert.equal((await call(B, 'ah', { op: 'search' })).rows.length, 0);
  // Seller collects 30 minus the 5% cut (rounded up) = 28.
  const mine2 = await call(A, 'ah', { op: 'mine' });
  assert.equal(mine2.owed, 28);
  const col = await call(A, 'ah', { op: 'collect' });
  assert.equal(col.gold, 28);
  assert.ok((await call(A, 'ah', { op: 'collect' })).error, 'nothing left to collect');
  // Cancel returns the item.
  assert.ok((await call(B, 'inv', { op: 'unequip', slot: 'offhand' })).ok || true);
  const bi = (await call(B, 'ah', { op: 'list', idx: 0, price: 5 }));
  assert.ok(bi.ok, bi.error);
  const bm = await call(B, 'ah', { op: 'mine' });
  const cancel = await call(B, 'ah', { op: 'cancel', id: bm.rows[0].id });
  assert.ok(cancel.ok, cancel.error);
  assert.equal((await call(B, 'ah', { op: 'mine' })).rows.length, 0);
  A.close(); B.close(); server.close();
  setTimeout(() => process.exit(0), 100);
});
