// A party of 1–4 players sharing one zone (town or dungeon floor), with a join code.
import { randomInt } from 'node:crypto';
import { Zone } from './zone.js';
import { RNG } from '../shared/rng.js';
import {
  PARTY_MAX, SKILLS, CLASSES, FREE_POINTS_PER_LEVEL, MAX_LEVEL, xpToNext, derive, syncedChar, canEquip, randomItem, makeItem,
  potionPrice, MAX_POTIONS, INV_SIZE, SLOTS, BASES, MATERIALS, RECIPES, CRAFT_BASES, salvageYield,
} from '../shared/rules.js';
import { lookOf } from './db.js';

export const parties = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!parties.has(c)) return c;
  }
}

export class Member {
  constructor({ pid, socket, accountId, charId, char }) {
    Object.assign(this, { pid, socket, accountId, charId, char });
    char.mats ||= {}; // heroes made before crafting existed
    // A duel was cut short by a server restart: give the stake back.
    if (char.duelEscrow) { char.gold += char.duelEscrow; delete char.duelEscrow; }
    this.dirty = false;
    this.hp = null; this.mp = null;
    this.shops = null;
    this.media = { mic: false };
    this.joinedAt = Date.now();
  }
  // syncCap is set by the zone (0 in town). Above it, the hero fights as a capped copy.
  derived(buffs) {
    const s = syncedChar(this.char, this.syncCap || 0);
    const d = derive(s || this.char, buffs);
    if (s) d.sync = s.level;
    return d;
  }
  get synced() { return !!this.syncCap && this.char.level > this.syncCap; }
  look() { return lookOf(this.char); }
}

export class Party {
  constructor(io, db, { solo = false } = {}) {
    this.io = io; this.db = db;
    this.code = newCode();
    this.solo = solo;
    this.members = new Map();
    this.leader = null;
    this.zone = null;
    this.room = `party:${this.code}`;
    this.travelTimer = null;
    parties.set(this.code, this);
    this.loop = setInterval(() => this.tick(), 50);
    this.saveLoop = setInterval(() => this.saveAll(), 15000);
  }

  get full() { return this.members.size >= PARTY_MAX; }

  broadcast(ev, data) { this.io.to(this.room).emit(ev, data); }
  emitTo(pid, ev, data) { this.members.get(pid)?.socket.emit(ev, data); }

  roster() {
    return [...this.members.values()].map((m) => ({ pid: m.pid, name: m.char.name, cls: m.char.cls, level: m.char.level, leader: m.pid === this.leader, mic: !!m.media.mic }));
  }
  sendRoster() { this.broadcast('party', { code: this.code, solo: this.solo, leader: this.leader, members: this.roster() }); }

  add(member) {
    this.members.set(member.pid, member);
    if (!this.leader) this.leader = member.pid;
    member.socket.join(this.room);
    member.party = this;
    if (!this.zone) this.zone = new Zone(this, { kind: 'town', seed: randomInt(2 ** 31) });
    this.zone.addPlayer(member);
    member.socket.emit('zone', this.zone.initFor(member.pid));
    this.sendRoster();
    if (this.members.size > 1) this.broadcast('msg', { text: `${member.char.name} joined the party`, kind: 'info' });
  }

  async remove(member, why = 'left') {
    if (!this.members.has(member.pid)) return;
    if (this.duelInvite && (this.duelInvite.from === member.pid || this.duelInvite.to === member.pid)) {
      const other = this.duelInvite.from === member.pid ? this.duelInvite.to : this.duelInvite.from;
      this.duelInvite = null; clearTimeout(this.duelInviteTimer); this.emitTo(other, 'duelInvite', null);
    }
    this.zone?.removePlayer(member.pid);
    this.members.delete(member.pid);
    member.socket.leave(this.room);
    member.party = null;
    this.broadcast('peerLeft', { pid: member.pid });
    await this.save(member);
    if (!this.members.size) { this.destroy(); return; }
    if (this.leader === member.pid) this.leader = this.members.keys().next().value;
    this.broadcast('msg', { text: `${member.char.name} ${why === 'disconnect' ? 'disconnected' : 'left the party'}`, kind: 'info' });
    this.sendRoster();
  }

  destroy() {
    clearInterval(this.loop); clearInterval(this.saveLoop); clearTimeout(this.travelTimer);
    parties.delete(this.code);
  }

  tick() {
    try { this.zone?.tick(); } catch (e) { console.error('zone tick', e); }
  }

  async save(m) {
    if (!m.dirty && m.savedOnce) return;
    m.dirty = false; m.savedOnce = true;
    m.char.playTime = (m.char.playTime || 0) + Math.round((Date.now() - (m.lastSaveAt || m.joinedAt)) / 1000);
    m.lastSaveAt = Date.now();
    try { await this.db.saveCharacter(m.accountId, m.charId, m.char); } catch (e) { console.error('save failed', e); }
  }
  async saveAll() { for (const m of this.members.values()) await this.save(m); }

  // ------------------------------------------------------------ progression
  grantXp(pid, amount) {
    const m = this.members.get(pid);
    if (!m) return;
    const ch = m.char;
    if (ch.level >= MAX_LEVEL) return;
    ch.xp += amount;
    let leveled = false;
    while (ch.level < MAX_LEVEL && ch.xp >= xpToNext(ch.level)) {
      ch.xp -= xpToNext(ch.level);
      ch.level++;
      leveled = true;
      const g = CLASSES[ch.cls].grow;
      for (const k of Object.keys(g)) ch.stats[k] += g[k];
      ch.statPts += FREE_POINTS_PER_LEVEL;
      ch.skillPts += 1;
    }
    m.dirty = true;
    if (leveled) {
      const p = this.zone?.players.get(pid);
      if (p) { this.zone.refreshStats(pid); p.hp = p.stats.hpMax; p.mp = p.stats.mpMax; }
      this.broadcast('levelup', { pid, level: ch.level, name: ch.name });
      this.sendChar(pid);
      this.sendRoster();
      this.save(m);
    } else {
      this.emitTo(pid, 'xp', { xp: ch.xp, next: xpToNext(ch.level), got: amount });
    }
  }

  sendChar(pid) {
    const m = this.members.get(pid);
    if (m) m.socket.emit('char', { char: m.char, next: xpToNext(m.char.level), derived: m.derived(this.zone?.players.get(pid)?.buffs) });
  }

  // ------------------------------------------------------------ inventory & character sheet
  // All inventory requests come through here so the server stays the authority on items.
  invAction(pid, a = {}) {
    const m = this.members.get(pid);
    if (!m) return 'Not in a party';
    const ch = m.char;
    const inv = ch.inv;
    const idx = Number(a.idx);
    const validIdx = (i) => Number.isInteger(i) && i >= 0 && i < INV_SIZE;
    switch (a.op) {
      case 'equip': {
        if (!validIdx(idx) || !inv[idx]) return 'Nothing there';
        const it = inv[idx];
        const err = canEquip(ch, it);
        if (err) return err;
        const old = ch.equip[it.slot] || null;
        ch.equip[it.slot] = it;
        inv[idx] = old;
        break;
      }
      case 'unequip': {
        const slot = String(a.slot);
        if (!SLOTS.includes(slot) || !ch.equip[slot]) return 'Nothing equipped there';
        const free = inv.findIndex((x) => !x);
        if (free < 0) return 'Your pack is full';
        inv[free] = ch.equip[slot];
        ch.equip[slot] = null;
        break;
      }
      case 'move': {
        const to = Number(a.to);
        if (!validIdx(idx) || !validIdx(to)) return 'Bad slot';
        [inv[idx], inv[to]] = [inv[to], inv[idx]];
        break;
      }
      case 'drop': {
        if (!validIdx(idx) || !inv[idx]) return 'Nothing there';
        if (!this.zone?.dropItem(pid, inv[idx])) return 'Can\'t drop that here';
        inv[idx] = null;
        break;
      }
      case 'sell': {
        if (!this.nearNpc(pid)) return 'Find a merchant to sell items';
        if (!validIdx(idx) || !inv[idx]) return 'Nothing there';
        ch.gold += inv[idx].value;
        inv[idx] = null;
        break;
      }
      case 'stat': {
        const k = String(a.stat);
        if (!['str', 'dex', 'vit', 'spi'].includes(k)) return 'Bad stat';
        if (ch.statPts < 1) return 'No points to spend';
        ch.statPts--; ch.stats[k]++;
        break;
      }
      case 'skill': {
        const id = String(a.skill);
        const sk = SKILLS[id];
        if (!sk || !CLASSES[ch.cls].skills.includes(id)) return 'Bad skill';
        if (ch.skillPts < 1) return 'No skill points';
        if (ch.level < sk.unlock) return `Unlocks at level ${sk.unlock}`;
        if ((ch.skills[id] || 0) >= sk.max) return 'Already mastered';
        ch.skillPts--; ch.skills[id] = (ch.skills[id] || 0) + 1;
        break;
      }
      case 'buy': {
        const npc = this.nearNpc(pid);
        if (!npc) return 'Too far from the shop';
        const stock = this.stockFor(m)[npc];
        const i = Number(a.i);
        const it = stock?.[i];
        if (!it) return 'Sold out';
        const price = it.value * 4;
        if (ch.gold < price) return 'Not enough gold';
        const free = inv.findIndex((x) => !x);
        if (free < 0) return 'Your pack is full';
        ch.gold -= price; inv[free] = it; stock.splice(i, 1);
        this.emitTo(pid, 'shop', { npc, stock: stock.map((s) => ({ ...s, price: s.value * 4 })), potions: npc === 'merchant' ? this.potionPrices(ch) : null });
        break;
      }
      case 'potion': {
        if (this.nearNpc(pid) !== 'merchant') return 'Find the trader to buy potions';
        const kind = a.kind === 'mp' ? 'mp' : 'hp';
        const n = Math.max(1, Math.min(MAX_POTIONS - ch.potions[kind], Number(a.n) || 1));
        if (ch.potions[kind] >= MAX_POTIONS) return 'Potion belt is full';
        const cost = potionPrice(kind, ch.level) * n;
        if (ch.gold < cost) return 'Not enough gold';
        ch.gold -= cost; ch.potions[kind] += n;
        break;
      }
      case 'salvage': {
        if (this.nearNpc(pid) !== 'crafter') return 'Find the artificer to salvage items';
        if (!validIdx(idx) || !inv[idx]) return 'Nothing there';
        const got = salvageYield(inv[idx]);
        for (const [k, n] of Object.entries(got)) ch.mats[k] = (ch.mats[k] || 0) + n;
        inv[idx] = null;
        this.emitTo(pid, 'salvaged', { got });
        break;
      }
      case 'salvageCommon': {
        if (this.nearNpc(pid) !== 'crafter') return 'Find the artificer to salvage items';
        const got = {}; let count = 0;
        inv.forEach((it, i) => {
          if (!it || it.rarity !== 'common') return;
          for (const [k, n] of Object.entries(salvageYield(it))) { got[k] = (got[k] || 0) + n; ch.mats[k] = (ch.mats[k] || 0) + n; }
          inv[i] = null; count++;
        });
        if (!count) return 'No common items in your pack';
        this.emitTo(pid, 'salvaged', { got, count });
        break;
      }
      case 'craft': {
        if (this.nearNpc(pid) !== 'crafter') return 'Find the artificer to craft';
        const r = RECIPES[a.recipe]; const base = String(a.base);
        if (!r || !CRAFT_BASES.includes(base)) return 'Unknown recipe';
        for (const [k, n] of Object.entries(r.cost)) if ((ch.mats[k] || 0) < n) return `Need ${n} ${MATERIALS[k].name}`;
        let trophy = null;
        if (r.trophy) {
          trophy = ['tusk', 'silk'].filter((k) => (ch.mats[k] || 0) >= r.trophy).sort((x, y) => (ch.mats[y] || 0) - (ch.mats[x] || 0))[0];
          if (!trophy) return 'Needs a boss trophy (Gravemaw\'s Tusk or Broodmother\'s Silk)';
        }
        const gold = r.gold(ch.level);
        if (ch.gold < gold) return `Need ${gold} gold`;
        const free = inv.findIndex((x) => !x);
        if (free < 0) return 'Your pack is full';
        for (const [k, n] of Object.entries(r.cost)) ch.mats[k] -= n;
        if (trophy) ch.mats[trophy] -= r.trophy;
        ch.gold -= gold;
        const rng = new RNG(randomInt(2 ** 31));
        const it = makeItem(rng, base, Math.max(1, ch.level + r.ilvlBonus), r.rarity);
        it.crafted = ch.name;
        inv[free] = it;
        this.emitTo(pid, 'crafted', { item: it });
        break;
      }
      default: return 'Unknown action';
    }
    m.dirty = true;
    if (['equip', 'unequip', 'stat', 'skill'].includes(a.op)) this.zone?.refreshStats(pid);
    this.sendChar(pid);
    return null;
  }

  nearNpc(pid) {
    const p = this.zone?.players.get(pid);
    if (!p || this.zone.map.kind !== 'town') return null;
    let best = null; let bd = 5;
    for (const n of this.zone.map.npcs) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n.id; } }
    return best;
  }

  potionPrices(ch) { return { hp: potionPrice('hp', ch.level), mp: potionPrice('mp', ch.level) }; }

  // Shop stock is rolled per player each time they come back to town.
  stockFor(m) {
    if (m.shops) return m.shops;
    const rng = new RNG(randomInt(2 ** 31));
    const lvl = Math.max(1, m.char.level);
    const ilvl = () => Math.max(1, lvl + rng.int(-1, 1));
    const smith = []; const merchant = [];
    for (let i = 0; i < 8; i++) smith.push(randomItem(rng, ilvl(), 0, ['weapon', 'offhand', 'head', 'chest', 'hands', 'feet']));
    smith.forEach((it, i) => { if (it.rarity === 'rare' || it.rarity === 'legendary') smith[i] = makeItem(rng, it.base, it.ilvl, 'magic'); });
    for (let i = 0; i < 4; i++) merchant.push(randomItem(rng, ilvl(), 0, ['ring', 'amulet']));
    merchant.forEach((it, i) => { if (it.rarity === 'common') merchant[i] = makeItem(rng, it.base, it.ilvl, 'magic'); if (it.rarity === 'legendary') merchant[i] = makeItem(rng, it.base, it.ilvl, 'rare'); });
    m.shops = { smith, merchant };
    return m.shops;
  }

  openShop(pid, npc) {
    const m = this.members.get(pid);
    if (!m) return;
    if (npc === 'crafter') { this.emitTo(pid, 'crafter', {}); return; }
    if (npc === 'auctioneer') { this.emitTo(pid, 'auction', {}); return; }
    const stock = this.stockFor(m)[npc] || [];
    this.emitTo(pid, 'shop', { npc, stock: stock.map((s) => ({ ...s, price: s.value * 4 })), potions: npc === 'merchant' ? this.potionPrices(m.char) : null });
  }

  // ------------------------------------------------------------ travel
  openGate(pid) {
    if (pid !== this.leader) { this.emitTo(pid, 'msg', { text: 'The party leader chooses where to go', kind: 'info' }); return; }
    // The deepest floor any of us has reached (so a new friend can be carried along).
    const max = Math.max(...[...this.members.values()].map((m) => m.char.maxFloor || 1));
    this.emitTo(pid, 'gate', { max });
  }

  requestTravel(pid, dest) {
    if (this.travelTimer) return;
    if (this.zone?.duel) { this.emitTo(pid, 'msg', { text: 'Wait for the duel to finish', kind: 'warn' }); return; }
    if (dest.kind === 'dungeon') {
      const floor = Math.max(1, Math.floor(Number(dest.floor) || 1));
      const max = Math.max(...[...this.members.values()].map((m) => m.char.maxFloor || 1));
      // From town you may pick any floor you've reached; stairs always go one deeper.
      const fromStairs = this.zone?.map.kind === 'dungeon' && floor === this.zone.spec.floor + 1;
      if (!fromStairs && floor > max) return;
      dest = { kind: 'dungeon', floor };
    }
    const who = this.members.get(pid)?.char.name || 'Someone';
    const label = dest.kind === 'town' ? 'Returning to town' : `Descending to floor ${dest.floor}`;
    this.broadcast('travel', { text: `${label}…`, by: who, delay: 1.2 });
    this.travelTimer = setTimeout(() => { this.travelTimer = null; this.goTo(dest); }, 1200);
  }

  goTo(dest) {
    for (const m of this.members.values()) {
      const p = this.zone?.players.get(m.pid);
      if (p) { m.hp = p.dead ? null : p.hp; m.mp = p.mp; }
      if (dest.kind === 'dungeon') m.char.maxFloor = Math.max(m.char.maxFloor || 1, dest.floor);
      if (dest.kind === 'town') m.shops = null; // fresh stock each visit
      m.dirty = true;
    }
    this.zone = new Zone(this, { kind: dest.kind, floor: dest.floor || 0, seed: randomInt(2 ** 31) });
    for (const m of this.members.values()) this.zone.addPlayer(m);
    for (const m of this.members.values()) m.socket.emit('zone', this.zone.initFor(m.pid));
    this.saveAll();
  }
}
