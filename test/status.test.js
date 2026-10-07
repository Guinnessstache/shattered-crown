// Buff/debuff timers: the server tells you what's on you and for how long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';

test('status events carry buffs and monster debuffs with time left', async () => {
  process.env.DEV_CMDS = '1';
  const { startServer } = await import('../server/index.js');
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-st-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reg = await post('/api/register', { username: 'statusguy', password: 'hunter22' });
  const s = connect(base, { auth: { token: reg.token }, transports: ['websocket'] });
  await new Promise((r) => s.once('connect', r));
  let st = []; s.on('status', (l) => { st = l; });
  try {
    const c = await call(s, 'createChar', { name: 'Brynn', cls: 'knight' });
    assert.ok((await call(s, 'play', { charId: c.id, mode: 'solo' })).ok);
    await sleep(300);
    await call(s, 'dev', { cmd: 'xp', n: 4000 }); await sleep(150);
    assert.ok((await call(s, 'inv', { op: 'skill', skill: 'warcry' })).ok);
    s.emit('skill', { id: 'warcry', rot: 0 }); await sleep(300);
    const wc = st.find((x) => x[0] === 'warcry');
    assert.ok(wc && wc[1] > 10 && wc[1] <= 12, `war cry ~12s left, got ${JSON.stringify(st)}`);
    await call(s, 'dev', { cmd: 'debuff', type: 'spider', dmg: 4 });
    await call(s, 'dev', { cmd: 'debuff', type: 'spider', dmg: 4 }); await sleep(300);
    const po = st.find((x) => x[0] === 'poison');
    assert.ok(po && po[2] === 2, `two poison stacks, got ${JSON.stringify(st)}`);
    await call(s, 'dev', { cmd: 'debuff', slow: 2 }); await sleep(300);
    assert.ok(st.some((x) => x[0] === 'slow'));
    await sleep(2300);
    assert.ok(!st.some((x) => x[0] === 'slow'), 'slow wore off');
  } finally { s.disconnect(); server.close(); setTimeout(() => process.exit(0), 300).unref(); }
});
