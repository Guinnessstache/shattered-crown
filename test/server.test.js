import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';

const call = (s, ev, d) => new Promise((r) => (d === undefined ? s.emit(ev, r) : s.emit(ev, d, r)));
const wait = (s, ev) => new Promise((r) => s.once(ev, r));

test('register, create hero, play, descend, fight, save', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sc-'));
  const { server } = await startServer({ port: 0, dataDir });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const reg = await post('/api/register', { username: 'tester', password: 'hunter22' });
  assert.ok(reg.ok, reg.error);
  assert.equal((await post('/api/register', { username: 'tester', password: 'hunter22' })).ok, false);
  assert.equal((await post('/api/login', { username: 'tester', password: 'nope' })).ok, false);
  const login = await post('/api/login', { username: 'Tester', password: 'hunter22' });
  assert.ok(login.ok);
  const s = connect(base, { auth: { token: login.token }, transports: ['websocket'] });
  await wait(s, 'connect');
  const c = await call(s, 'createChar', { name: 'Sir Test', cls: 'knight' });
  assert.ok(c.ok, c.error);
  const list = await call(s, 'chars');
  assert.equal(list.chars.length, 1);
  const zoneP = wait(s, 'zone');
  const play = await call(s, 'play', { charId: c.id, mode: 'host' });
  assert.ok(play.ok, play.error);
  const town = await zoneP;
  assert.equal(town.kind, 'town');
  // Walk to the gate in hops (server limits speed), then go down.
  const me = town.players.find((p) => p.pid === play.pid);
  let x = me.x; let y = me.y;
  const { generateTown, distanceField, toTile, TILE } = await import('../shared/map.js');
  const tm = generateTown();
  const tgt = tm.exit;
  const field = distanceField(tm, [tgt], 999);
  let corr = null; s.on('correct', (c) => { corr = c; });
  for (let i = 0; i < 400 && Math.hypot(tgt.x - x, tgt.y - y) > 1.5; i++) {
    if (corr) { x = corr.x; y = corr.y; corr = null; }
    const tx = toTile(x); const ty = toTile(y);
    let best = [tgt.x, tgt.y]; let bd = field[ty * tm.w + tx];
    for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const v = field[(ty + oy) * tm.w + tx + ox]; if (v >= 0 && v < bd) { bd = v; best = [(tx + ox) * TILE + 1, (ty + oy) * TILE + 1]; } }
    const d = Math.hypot(best[0] - x, best[1] - y) || 1; const st = Math.min(d, 0.25);
    x += (best[0] - x) / d * st; y += (best[1] - y) / d * st;
    s.emit('pos', { x, y, rot: 0 });
    await new Promise((r) => setTimeout(r, 40));
  }
  const gateP = wait(s, 'gate');
  s.emit('interact', {});
  const gate = await gateP;
  assert.equal(gate.max, 1);
  const dz = wait(s, 'zone');
  const g = await call(s, 'gate', { floor: 1 });
  assert.ok(g.ok, g.error);
  const dun = await dz;
  assert.equal(dun.kind, 'dungeon');
  assert.ok(dun.ents.filter((e) => e.k === 'm').length > 5);
  // Teleport-ish: attack monsters by walking to them is slow; just swing a lot at spawn and check snaps flow.
  let snaps = 0; let dmg = 0;
  s.on('snap', (sn) => { snaps++; for (const e of sn.ev) if (e.t === 'dmg') dmg++; });
  for (let i = 0; i < 10; i++) { s.emit('atk', { rot: i }); await new Promise((r) => setTimeout(r, 120)); }
  assert.ok(snaps > 5, 'snapshots arrive');
  // inventory op + stat
  const r = await call(s, 'inv', { op: 'stat', stat: 'str' });
  assert.equal(r.ok, false); // no points at level 1
  const lg = await call(s, 'leaveGame');
  assert.ok(lg.ok);
  const after = await call(s, 'chars');
  assert.equal(after.chars[0].maxFloor, 1);
  s.close();
  server.close();
  setTimeout(() => process.exit(0), 100);
});
