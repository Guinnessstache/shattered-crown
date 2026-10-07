import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';

const call = (s, ev, d) => new Promise((r) => (d === undefined ? s.emit(ev, r) : s.emit(ev, d, r)));
const wait = (s, ev, pred = () => true, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
  const h = (d) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); res(d); } };
  s.on(ev, h);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('duel: challenge, escrow, fight, winner takes the pot', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sc-duel-'));
  const { server } = await startServer({ port: 0, dataDir });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  async function hero(user, name, mode, code) {
    const reg = await post('/api/register', { username: user, password: 'hunter22' });
    const s = connect(base, { auth: { token: reg.token }, transports: ['websocket'] });
    await wait(s, 'connect');
    const c = await call(s, 'createChar', { name, cls: 'berserker' });
    const z = wait(s, 'zone');
    const play = await call(s, 'play', { charId: c.id, mode, code });
    assert.ok(play.ok, play.error);
    await z;
    s.pid = play.pid; s.code = play.code; s.gold = play.char.gold;
    s.on('char', (d) => { s.gold = d.char.gold; });
    return s;
  }
  const A = await hero('duela', 'Ayla', 'host');
  const B = await hero('duelb', 'Bram', 'join', A.code);
  assert.equal(A.gold, 50);
  assert.ok((await call(A, 'duel', { op: 'challenge', to: B.pid, stake: 999 })).error, 'cannot stake more than you have');
  const inv = wait(B, 'duelInvite', (d) => d);
  assert.ok((await call(A, 'duel', { op: 'challenge', to: B.pid, stake: 40 })).ok);
  assert.equal((await inv).stake, 40);
  const start = wait(A, 'duel', (d) => d.state === 'countdown');
  const fight = wait(A, 'duel', (d) => d.state === 'fight');
  assert.ok((await call(B, 'duel', { op: 'accept' })).ok);
  const st = await start;
  await sleep(200);
  assert.equal(A.gold, 10, 'stake held');
  assert.equal(B.gold, 10, 'stake held');
  // Track positions from snapshots, then walk A over to B and swing until the duel ends.
  let pos = {};
  let dmgs = 0; A.on('snap', (sn) => { for (const [id, x, y] of sn.p) pos[id] = { x, y }; for (const e of sn.ev) if (e.t === 'dmg') dmgs++; });
  await fight;
  const end = wait(A, 'duel', (d) => d.state === 'end', 95000);
  let done = false; end.then(() => { done = true; });
  for (let i = 0; i < 1400 && !done; i++) {
    const me = pos[st.a]; const them = pos[st.b];
    if (me && them) {
      const d = Math.hypot(them.x - me.x, them.y - me.y);
      const rot = Math.atan2(them.x - me.x, them.y - me.y);
      if (d > 1.6) { const k = Math.min(0.25, d - 1.4) / d; A.emit('pos', { x: me.x + (them.x - me.x) * k, y: me.y + (them.y - me.y) * k, rot }); pos[st.a] = { x: me.x + (them.x - me.x) * k, y: me.y + (them.y - me.y) * k }; }
      else A.emit('atk', { rot });
    }
    await sleep(60);
  }
  const res = await end;
  assert.equal(res.wn, 'Ayla');
  assert.equal(res.reason, 'ko');
  await sleep(300);
  assert.equal(A.gold, 90, 'winner gets both stakes');
  assert.equal(B.gold, 10, 'loser lost their stake');
  A.close(); B.close(); server.close();
  setTimeout(() => process.exit(0), 100);
});
