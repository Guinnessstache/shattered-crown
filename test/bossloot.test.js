// Every boss kill drops at least one legendary for each hero in the party.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';

test('boss drops a legendary for every hero', async () => {
  process.env.DEV_CMDS = '1';
  const { startServer } = await import('../server/index.js');
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-bl-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const socks = [];
  async function hero(user, name, mode, code) {
    const { token } = await post('/api/register', { username: user, password: 'hunter22' });
    const s = connect(base, { auth: { token }, transports: ['websocket'] }); socks.push(s);
    await new Promise((r) => s.once('connect', r));
    const c = await call(s, 'createChar', { name, cls: 'knight' });
    s.loot = []; s.on('add', (list) => { for (const e of list) if (e.k === 'l' && e.item) s.loot.push(e.item); });
    s.res = await call(s, 'play', { charId: c.id, mode, code });
    return s;
  }
  try {
    for (let run = 0; run < 3; run++) {
      const a = await hero(`bossa${run}`, `Alda${'abc'[run]}`, 'host');
      const b = await hero(`bossb${run}`, `Brin${'abc'[run]}`, 'join', a.res.code);
      await call(a, 'dev', { cmd: 'floor', floor: 5 }); await sleep(2500);
      a.loot = []; b.loot = [];
      await call(a, 'dev', { cmd: 'killboss' }); await sleep(400);
      for (const s of [a, b]) {
        assert.ok(s.loot.some((it) => it.rarity === 'legendary'), `each hero gets a legendary (got ${s.loot.map((i) => i.rarity).join(', ')})`);
      }
      a.disconnect(); b.disconnect();
    }
  } finally { socks.forEach((s) => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 300).unref(); }
});
