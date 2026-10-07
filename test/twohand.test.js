// Two-handed weapons: no shield alongside one, the other piece goes to the pack (or the swap is refused when it's full).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { newCharacter, makeItem, derive, isTwoHanded, itemLines, BASES, canEquip } from '../shared/rules.js';
import { RNG } from '../shared/rng.js';

test('two-handed bases hit harder, reach further and say so', () => {
  const rng = new RNG(3);
  const ga = makeItem(rng, 'greataxe', 12, 'common'); const ax = makeItem(rng, 'axe', 12, 'common');
  assert.ok(isTwoHanded(ga) && !isTwoHanded(ax));
  assert.ok(BASES.greataxe.dmg > BASES.axe.dmg && BASES.greatsword.reach > BASES.sword.reach);
  assert.ok(itemLines(ga).some((l) => /Two-handed/.test(l)));
  const b = newCharacter('Brak', 'berserker');
  assert.equal(b.equip.weapon.base, 'greataxe', 'berserkers start with a great axe');
  assert.ok(derive(b).reach >= 2.7);
  const sh = makeItem(rng, 'shield', 1, 'common');
  assert.match(canEquip(b, sh) || '', /can't use shields/, 'berserkers take no shield');
  assert.equal(canEquip(newCharacter('Gar', 'knight'), sh), null);
});

test('equipping a two-hander moves the shield to the pack, and back', async () => {
  process.env.DEV_CMDS = '1';
  const { startServer } = await import('../server/index.js');
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-2h-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const call = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reg = await post('/api/register', { username: 'twohand', password: 'hunter22' });
  const s = connect(base, { auth: { token: reg.token }, transports: ['websocket'] });
  await new Promise((r) => s.once('connect', r));
  let ch = null; s.on('char', (d) => { ch = d.char; });
  try {
  const c = await call(s, 'createChar', { name: 'Gareth', cls: 'knight' });
  assert.ok((await call(s, 'play', { charId: c.id, mode: 'solo' })).ok);
  await sleep(300);
  await call(s, 'dev', { cmd: 'item', base: 'greatsword', rarity: 'common', ilvl: 1 }); await sleep(150);
  assert.ok(ch.equip.offhand, 'knight starts with a shield');
  const gsIdx = ch.inv.findIndex((x) => x?.base === 'greatsword');
  assert.ok((await call(s, 'inv', { op: 'equip', idx: gsIdx })).ok); await sleep(150);
  assert.equal(ch.equip.weapon.base, 'greatsword');
  assert.equal(ch.equip.offhand, null, 'shield came off');
  assert.ok(ch.inv.some((x) => x?.base === 'shield') && ch.inv.some((x) => x?.base === 'sword'), 'sword and shield are in the pack');
  // Shield Bash needs a shield
  await call(s, 'dev', { cmd: 'xp', n: 400 }); await sleep(150);
  assert.ok((await call(s, 'inv', { op: 'skill', skill: 'bash' })).ok); await sleep(150);
  const msgs = []; s.on('msg', (m) => msgs.push(m.text));
  s.emit('skill', { id: 'bash', rot: 0 }); await sleep(250);
  assert.ok(msgs.some((t) => /needs a shield/.test(t)), 'bash refused without a shield');
  // put the shield back on: the greatsword comes off
  const shIdx = ch.inv.findIndex((x) => x?.base === 'shield');
  assert.ok((await call(s, 'inv', { op: 'equip', idx: shIdx })).ok); await sleep(150);
  assert.equal(ch.equip.offhand.base, 'shield'); assert.equal(ch.equip.weapon, null, 'two-hander came off');
  msgs.length = 0; s.emit('skill', { id: 'bash', rot: 0 }); await sleep(250);
  assert.ok(!msgs.some((t) => /needs a shield/.test(t)), 'bash works with a shield');
  // sword back in hand, pack full: the greatsword swap is refused and nothing is lost
  assert.ok((await call(s, 'inv', { op: 'equip', idx: ch.inv.findIndex((x) => x?.base === 'sword') })).ok); await sleep(150);
  const gs2 = ch.inv.findIndex((x) => x?.base === 'greatsword');
  for (let i = 0; i < 40; i++) await call(s, 'dev', { cmd: 'item', base: 'ring', rarity: 'common', ilvl: 1 });
  await sleep(300);
  assert.ok(ch.inv.every(Boolean), 'pack is full');
  const r = await call(s, 'inv', { op: 'equip', idx: gs2 }); await sleep(150);
  assert.match(r.error || '', /room/);
  assert.equal(ch.equip.offhand.base, 'shield'); assert.equal(ch.equip.weapon.base, 'sword'); assert.equal(ch.inv[gs2].base, 'greatsword');
  } finally { s.disconnect(); server.close(); setTimeout(() => process.exit(0), 300).unref(); }
});
