// Level sync: heroes far above a floor fight at its cap, keep skills, earn bonus XP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCharacter, makeItem, derive, syncedChar, syncCapFor, SYNC, CLASSES } from '../shared/rules.js';
import { RNG } from '../shared/rng.js';

function leveled(cls, level) {
  const ch = newCharacter('Tester', cls);
  const g = CLASSES[cls].grow;
  for (let l = 1; l < level; l++) { for (const k of Object.keys(g)) ch.stats[k] += g[k]; ch.stats.str += 3; }
  ch.level = level;
  const rng = new RNG(7);
  ch.equip.weapon = makeItem(rng, 'sword', level, 'rare');
  ch.equip.chest = makeItem(rng, 'chest', level, 'rare');
  return ch;
}

test('cap follows the floor and is off in town', () => {
  assert.equal(syncCapFor(0), 0);
  assert.equal(syncCapFor(2), 3 + SYNC.margin);
  assert.equal(syncCapFor(10), 15 + SYNC.margin);
});

test('a level 30 hero on floor 2 fights near a level 5 hero', () => {
  const hi = leveled('knight', 30); const lo = leveled('knight', 5);
  const cap = syncCapFor(2);
  const s = syncedChar(hi, cap);
  assert.ok(s, 'should be synced');
  assert.equal(s.level, cap);
  const dHi = derive(hi); const dS = derive(s); const dLo = derive(lo);
  assert.ok(dS.hpMax < dHi.hpMax * 0.5, `synced life ${dS.hpMax} vs full ${dHi.hpMax}`);
  assert.ok(dS.dmg[1] < dHi.dmg[1] * 0.5, `synced damage ${dS.dmg} vs full ${dHi.dmg}`);
  assert.ok(dS.hpMax <= dLo.hpMax * 1.6, `synced life ${dS.hpMax} should be near a real low-level hero ${dLo.hpMax}`);
  assert.deepEqual(s.skills, hi.skills, 'skills and ranks are kept');
  assert.equal(hi.level, 30, 'the real character is untouched');
  assert.ok(hi.equip.weapon.dmg[1] > s.equip.weapon.dmg[1], 'gear is scaled on the copy only');
});

test('heroes at or under the cap are not synced', () => {
  assert.equal(syncedChar(leveled('druid', 5), syncCapFor(2)), null);
  assert.equal(syncedChar(leveled('druid', 40), 0), null);
});

// Group sync (EverQuest 2 style mentoring): in a dungeon everyone drops to the lowest hero's level.
test('group: a level 18 hero drops to a level 13 friend in the dungeon, and back up when they leave', async () => {
  process.env.DEV_CMDS = '1';
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { io: connect } = await import('socket.io-client');
  const { startServer } = await import('../server/index.js');
  const { xpToNext } = await import('../shared/rules.js');
  const call = (s, ev, d) => new Promise((r) => (d === undefined ? s.emit(ev, r) : s.emit(ev, d, r)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { server } = await startServer({ port: 0, dataDir: mkdtempSync(path.join(tmpdir(), 'sc-gsync-')) });
  const base = `http://localhost:${server.address().port}`;
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  async function hero(user, name, level, mode, code) {
    const reg = await post('/api/register', { username: user, password: 'hunter22' });
    const s = connect(base, { auth: { token: reg.token }, transports: ['websocket'] });
    await new Promise((r) => s.once('connect', r));
    const c = await call(s, 'createChar', { name, cls: 'knight' });
    s.on('char', (d) => { s.level = d.char.level; s.sync = d.derived.sync || 0; });
    s.on('party', (p) => { s.roster = p.members; });
    const play = await call(s, 'play', { charId: c.id, mode, code });
    assert.ok(play.ok, play.error);
    s.code = play.code; s.pid = play.pid;
    await sleep(300);
    let need = 0; for (let l = 1; l < level; l++) need += xpToNext(l);
    await call(s, 'dev', { cmd: 'xp', n: need });
    await sleep(300);
    assert.equal(s.level, level);
    return s;
  }
  const dad = await hero('gsdad', 'Dad', 18, 'host');
  const kid = await hero('gskid', 'Kid', 13, 'join', dad.code);
  assert.equal(dad.sync, 0, 'no sync in town');
  await call(dad, 'dev', { cmd: 'floor', floor: 11 }); // deep floor: the floor alone would not cap a level 18
  await sleep(2500);
  assert.equal(dad.sync, 13, 'dad fights at the kid\'s level');
  assert.equal(kid.sync, 0, 'the kid is not synced');
  assert.equal(dad.roster.find((m) => m.name === 'Dad').sync, 13, 'party list shows the synced level');
  kid.disconnect();
  await sleep(800);
  assert.equal(dad.sync, 0, 'sync lifts when the low-level friend leaves');
  dad.disconnect();
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});
