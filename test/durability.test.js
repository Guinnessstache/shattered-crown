// Item durability: wear, broken gear gives nothing, repairs at the smith cost more for better gear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { makeItem, newCharacter, derive, durOf, wear, isBroken, repairCost, DURABILITY } from '../shared/rules.js';
import { RNG } from '../shared/rng.js';
import { generateTown } from '../shared/map.js';

test('durability rules', () => {
  const rng = new RNG(5);
  const sw = makeItem(rng, 'sword', 10, 'rare');
  assert.deepEqual(durOf(sw), [DURABILITY.max.weapon, DURABILITY.max.weapon]);
  assert.equal(durOf(makeItem(rng, 'ring', 10, 'rare')), null, 'jewelry never wears');
  assert.equal(durOf({ slot: 'chest', value: 5 })[0], DURABILITY.max.chest, 'old items start at full');
  assert.equal(repairCost(sw), 0);
  wear(sw, 20);
  const cheap = makeItem(rng, 'sword', 3, 'rare'); wear(cheap, 20);
  const dear = makeItem(rng, 'sword', 30, 'rare'); wear(dear, 20);
  assert.ok(repairCost(dear) > repairCost(cheap) * 5, `higher item level costs more (${repairCost(cheap)} vs ${repairCost(dear)})`);
  const ch = newCharacter('Ty', 'knight');
  const before = derive(ch);
  assert.ok(wear(ch.equip.weapon, 999), 'reaching 0 breaks it');
  assert.ok(isBroken(ch.equip.weapon));
  const after = derive(ch);
  assert.ok(after.dmg[1] < before.dmg[1] || after.weaponKind === 'none', 'a broken weapon gives nothing');
  wear(ch.equip.offhand, 999);
  assert.ok(derive(ch).block < before.block, 'a broken shield blocks nothing');
});

test('repairing at the smith', async () => {
  process.env.DEV_CMDS = '1';
  const { startServer } = await import('../server/index.js');
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-dur-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { token } = await post('/api/register', { username: 'fixer', password: 'hunter22' });
  const s = connect(base, { auth: { token }, transports: ['websocket'] });
  await new Promise((r) => s.once('connect', r));
  let ch = null; let dv = null; s.on('char', (d) => { ch = d.char; dv = d.derived; });
  try {
    const c = await call(s, 'createChar', { name: 'Fixer', cls: 'knight' });
    assert.ok((await call(s, 'play', { charId: c.id, mode: 'solo' })).ok);
    await sleep(200);
    await call(s, 'dev', { cmd: 'wear', n: 0 }); await sleep(150);
    assert.equal(dv.block, 0, 'broken shield: no block');
    assert.match((await call(s, 'inv', { op: 'repairAll' })).error, /Smith/);
    const smith = generateTown().npcs.find((n) => n.id === 'smith');
    await call(s, 'dev', { cmd: 'tp', x: smith.x - 1, y: smith.y }); await sleep(150);
    await call(s, 'dev', { cmd: 'gold', n: 5000 }); await sleep(150);
    const g0 = ch.gold;
    assert.ok((await call(s, 'inv', { op: 'repairAll' })).ok); await sleep(150);
    assert.ok(ch.gold < g0, 'repairs cost gold');
    for (const it of Object.values(ch.equip)) if (durOf(it)) assert.equal(durOf(it)[0], durOf(it)[1]);
    assert.ok(dv.block > 0, 'shield works again');
    assert.match((await call(s, 'inv', { op: 'repairAll' })).error, /Nothing/);
  } finally { s.disconnect(); server.close(); setTimeout(() => process.exit(0), 300).unref(); }
});
