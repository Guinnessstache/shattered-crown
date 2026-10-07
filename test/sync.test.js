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
