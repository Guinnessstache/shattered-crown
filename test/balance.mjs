// Headless balance check: an autopilot knight clears floors and we report time, deaths, level.
import { Zone } from '../server/zone.js';
import { Member } from '../server/party.js';
import { newCharacter, xpToNext, CLASSES, FREE_POINTS_PER_LEVEL, SKILLS } from '../shared/rules.js';
import { moveCircle } from '../shared/map.js';

const ch = newCharacter('Bot');
const fake = { emit() {}, join() {}, leave() {} };
const member = new Member({ pid: '1', socket: fake, accountId: 1, charId: 1, char: ch });
const log = [];
const party = {
  members: new Map([['1', member]]),
  emitTo(pid, ev, d) { if (ev === 'died') log.push('died'); },
  broadcast() {},
  grantXp(pid, xp) {
    ch.xp += xp;
    while (ch.xp >= xpToNext(ch.level)) { ch.xp -= xpToNext(ch.level); ch.level++; for (const k in CLASSES.knight.grow) ch.stats[k]++; ch.stats.str += 2; ch.stats.vit += 1; if (ch.level >= 2) ch.skills.bash = Math.max(ch.skills.bash, 1); ch.skills.cleave++; zone.refreshStats('1'); }
  },
  requestTravel() {}, openGate() {}, openShop() {},
};
let zone;
const autoEquip = () => {
  // equip any item with a higher "score"
  const score = (it) => it ? (it.dmg ? (it.dmg[0] + it.dmg[1]) * 3 : 0) + (it.armor || 0) + Object.values(it.mods).reduce((a, b) => a + b, 0) : -1;
  ch.inv.forEach((it, i) => { if (it && it.req <= ch.level && score(it) > score(ch.equip[it.slot])) { const old = ch.equip[it.slot]; ch.equip[it.slot] = it; ch.inv[i] = old; } });
  ch.inv = ch.inv.map((x) => (x && x.rarity === 'common' ? null : x));
  ch.potions.hp = Math.max(ch.potions.hp, 6); // buys potions in town
};
for (let floor = 1; floor <= 12; floor++) {
  zone = new Zone(party, { kind: 'dungeon', floor, seed: 1000 + floor });
  const p = zone.addPlayer(member);
  let t = 0; let deaths = 0;
  const start = log.length;
  while (t < 900) {
    t += 0.05;
    // autopilot
    if (!p.dead) {
      let target = null; let bd = 1e9;
      for (const e of zone.ents.values()) if (e.k === 'm' && e.state !== 'dead') { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; target = e; } }
      for (const e of zone.ents.values()) if (e.k === 'l' && e.item && Math.hypot(e.x - p.x, e.y - p.y) < 3) zone.onPickup('1', { id: e.id });
      if (!target) break;
      if (p.hp < p.stats.hpMax * 0.35) zone.onPotion('1', { kind: 'hp' });
      const rot = Math.atan2(target.x - p.x, target.y - p.y);
      if (bd < p.stats.reach) {
        if (ch.skills.cleave && p.mp > 20 && (p.cds.cleave || 0) < zone.time) zone.onSkill('1', { id: 'cleave', rot });
        else zone.onAttack('1', { rot });
      } else {
        // path using the zone's field toward the target (reuse monster pathing)
        const fake = { x: p.x, y: p.y, r: p.r, rot: 0 };
        const field = zone.field; zone.field = null;
        const { distanceField } = await import('../shared/map.js');
        if (!p._f || p._ft !== target.id || Math.random() < 0.05) { p._f = distanceField(zone.map, [target], 200); p._ft = target.id; }
        zone.field = p._f; zone.pathStep(fake, target, p.stats.moveSpeed, 0.05); zone.field = field;
        zone.onMove('1', { x: fake.x, y: fake.y, rot });
      }
    }
    zone.tick();
  }
  deaths = log.length - start;
  autoEquip();
  const mobs = [...zone.ents.values()].filter((e) => e.k === 'm' && e.state !== 'dead').length;
  console.log(`floor ${floor}: ${t.toFixed(0)}s  deaths ${deaths}  left ${mobs}  lvl ${ch.level}  hp ${p.stats.hpMax} dmg ${p.stats.dmg} armor ${p.stats.armor} gold ${ch.gold} pots ${ch.potions.hp}`);
  zone.removePlayer('1');
  member.hp = null;
}
process.exit(0);
