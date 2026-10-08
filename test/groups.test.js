// Group finder and the players-online count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';

const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
const wait = (s, ev) => new Promise((r) => s.once(ev, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('group finder lists parties and lets you join from a game', async () => {
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-gf-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const socks = [];
  async function hero(user, name) {
    const { token } = await post('/api/register', { username: user, password: 'hunter22' });
    const s = connect(base, { auth: { token }, transports: ['websocket'] });
    socks.push(s);
    await wait(s, 'connect');
    s.charId = (await call(s, 'createChar', { name, cls: 'knight' })).id;
    return s;
  }
  try {
    const a = await hero('leaderacct', 'Leader');
    const b = await hero('joineracct', 'Joiner');
    const c = await hero('quietacct', 'Quiet');
    let g = await call(b, 'groups', {});
    assert.equal(g.online, 0); assert.equal(g.groups.length, 0);

    const host = await call(a, 'play', { charId: a.charId, mode: 'host', listed: true });
    assert.ok(host.ok);
    await call(c, 'play', { charId: c.charId, mode: 'host', listed: false }); // unlisted party stays hidden
    assert.ok((await call(b, 'play', { charId: b.charId, mode: 'solo' })).ok);
    await sleep(100);
    g = await call(b, 'groups', {});
    assert.equal(g.online, 3);
    assert.equal(g.groups.length, 1);
    assert.equal(g.groups[0].leader, 'Leader'); assert.equal(g.groups[0].where, 'In town'); assert.equal(g.groups[0].size, 1);

    // only the leader lists / writes the note; solo games can't be listed
    assert.ok((await call(a, 'listParty', { on: true, note: '  Floor 3,   all welcome  ' })).ok);
    assert.match((await call(b, 'listParty', { on: true })).error, /Solo/);
    g = await call(b, 'groups', {});
    assert.equal(g.groups[0].note, 'Floor 3, all welcome');

    // a bad code doesn't drop you out of your game
    assert.match((await call(b, 'play', { charId: b.charId, mode: 'join', code: 'ZZZZZ' })).error, /No party/);
    assert.ok((await call(b, 'groups', {})).mine, 'still in a game');
    // join from inside the solo game
    const party = wait(b, 'party');
    const j = await call(b, 'play', { charId: b.charId, mode: 'join', code: host.code });
    assert.ok(j.ok, j.error); assert.equal(j.code, host.code);
    assert.equal((await party).members.length, 2);
    g = await call(b, 'groups', {});
    assert.equal(g.groups[0].size, 2); assert.equal(g.mine, host.code); assert.equal(g.online, 3);
    assert.match((await call(b, 'listParty', { on: false })).error, /leader/);
    assert.match((await call(b, 'play', { charId: b.charId, mode: 'join', code: host.code })).error, /already/);
    // unlisting hides it
    assert.ok((await call(a, 'listParty', { on: false })).ok);
    assert.equal((await call(b, 'groups', {})).groups.length, 0);
  } finally { socks.forEach((s) => s.disconnect()); server.close(); setTimeout(() => process.exit(0), 300).unref(); }
});
