// One live area for a party: the town or a dungeon floor. Runs monsters, combat and loot.
// The server is the authority for damage, deaths, drops and XP; players move themselves
// (client-side prediction) and the server checks those moves.
import { buildMap, moveCircle, lineOfSight, distanceField, toTile, TILE, isBossFloor } from '../shared/map.js';
import { RNG, hashSeed } from '../shared/rng.js';
import { MONSTERS, SKILLS, monsterStats, armorReduction, randomItem, makeItem, MAX_POTIONS, MATERIALS, BOSS_TROPHY } from '../shared/rules.js';

const TICK = 1 / 20;
const PLAYER_R = 0.45;
const SLEEP_DIST = 38;
const RESPAWN_S = 5;

let nextId = 1;
const eid = (p) => `${p}${(nextId++).toString(36)}`;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Zone {
  /**
   * @param {object} party  the owning Party (members, emit helpers, rewards)
   * @param {{kind:'town'|'dungeon', floor?:number, seed?:number}} spec
   */
  constructor(party, spec) {
    this.party = party;
    this.spec = { kind: spec.kind, floor: spec.floor || 0, seed: spec.seed >>> 0 };
    this.map = buildMap(this.spec);
    this.rng = new RNG(hashSeed('zone', this.spec.seed, this.spec.floor, Date.now()));
    this.ents = new Map(); // everything that isn't a player
    this.players = new Map(); // pid -> player entity
    this.events = [];
    this.time = 0;
    this.fieldAt = 0;
    this.field = null;
    this.bossAlive = false;
    this.snapEvery = 2; this.tickN = 0;
    this.travel = null; // pending stairs countdown
    const partySize = Math.max(1, party.members.size);
    if (this.spec.kind === 'dungeon') {
      for (const s of this.map.spawns) this.spawnMonster(s.type, s.x, s.y, { elite: s.elite, boss: s.boss, partySize, quiet: true });
      for (const b of this.map.breakables) this.addEnt({ id: eid('b'), k: 'b', type: b.type, x: b.x, y: b.y, r: 0.45, hp: 1 }, true);
      for (const c of this.map.chests) this.addEnt({ id: eid('c'), k: 'c', x: c.x, y: c.y, rot: c.rot, open: false, boss: !!c.boss }, true);
    }
  }

  // ------------------------------------------------------------ entities
  addEnt(e, quiet = false) {
    this.ents.set(e.id, e);
    if (!quiet) {
      if (e.owner) this.party.emitTo(e.owner, 'add', [this.describe(e)]);
      else this.events.push({ t: 'add', e: this.describe(e) });
    }
    return e;
  }

  delEnt(id) {
    const e = this.ents.get(id);
    if (!e) return;
    this.ents.delete(id);
    if (e.owner) this.party.emitTo(e.owner, 'del', [id]);
    else this.events.push({ t: 'del', id });
  }

  spawnMonster(type, x, y, { elite = false, boss = false, partySize = 1, quiet = false } = {}) {
    const d = MONSTERS[type];
    const st = monsterStats(type, Math.max(1, this.spec.floor), { elite, partySize });
    const m = {
      id: eid('m'), k: 'm', type, x, y, rot: this.rng.float(0, Math.PI * 2), r: d.r * (elite ? 1.25 : 1),
      hp: st.hp, hpMax: st.hp, dmg: st.dmg, xp: st.xp, level: st.level, speed: st.speed,
      elite, boss: boss || !!d.boss, name: (elite ? 'Champion ' : '') + d.name,
      state: 'idle', target: null, t: 0, cdUntil: 0, stunUntil: 0, slowUntil: 0, think: this.rng.float(0, 0.5),
      homeX: x, homeY: y, slamAt: 0, summoned: 0, anim: 0,
    };
    if (m.boss) { this.bossAlive = true; m.slamAt = 6; }
    return this.addEnt(m, quiet);
  }

  describe(e) {
    switch (e.k) {
      case 'm': return { id: e.id, k: 'm', type: e.type, x: r1(e.x), y: r1(e.y), rot: r2(e.rot), hp: e.hp, hpMax: e.hpMax, elite: e.elite, boss: e.boss, name: e.name, level: e.level, dead: e.state === 'dead' };
      case 'b': return { id: e.id, k: 'b', type: e.type, x: r1(e.x), y: r1(e.y) };
      case 'c': return { id: e.id, k: 'c', x: e.x, y: e.y, rot: e.rot, open: e.open, boss: e.boss };
      case 'l': return { id: e.id, k: 'l', x: r1(e.x), y: r1(e.y), gold: e.gold || 0, potion: e.potion || null, mat: e.mat || null, n: e.n || 0, item: e.item || null };
      case 'x': return { id: e.id, k: 'x', kind: e.kind, x: r1(e.x), y: r1(e.y), vx: r2(e.vx), vy: r2(e.vy) };
      default: return null;
    }
  }

  describePlayer(p) {
    return { id: p.id, k: 'p', pid: p.pid, name: p.name, cls: p.cls, level: p.member.char.level, look: p.member.look(), x: r1(p.x), y: r1(p.y), rot: r2(p.rot), hp: Math.ceil(p.hp), hpMax: p.stats.hpMax, dead: p.dead };
  }

  // Everything a newly arrived player needs to draw the zone.
  initFor(pid) {
    const ents = [];
    for (const e of this.ents.values()) {
      if (e.owner && e.owner !== pid) continue;
      if (e.k === 'm' && e.state === 'dead') continue;
      ents.push(this.describe(e));
    }
    const players = [...this.players.values()].map((p) => this.describePlayer(p));
    return { ...this.spec, theme: this.map.theme, ents, players, bossAlive: this.bossAlive, npcs: this.map.npcs };
  }

  // ------------------------------------------------------------ players
  addPlayer(member) {
    const n = this.players.size;
    const off = [[0, 0], [1.2, 0], [0, 1.2], [1.2, 1.2]][n % 4];
    let { x, y } = this.map.start;
    x += off[0]; y += off[1];
    if (!this.map.walkableAt(x, y)) ({ x, y } = this.map.start);
    const stats = member.derived();
    const p = {
      id: `p${member.pid}`, k: 'p', pid: member.pid, member, name: member.char.name, cls: member.char.cls,
      x, y, rot: 0, r: PLAYER_R, hp: member.hp ?? stats.hpMax, mp: member.mp ?? stats.mpMax, stats,
      dead: false, respawnAt: 0, cds: {}, buffs: {}, lastPosAt: this.time, potionAt: 0, moved: 0,
    };
    p.hp = Math.min(p.hp, stats.hpMax); p.mp = Math.min(p.mp, stats.mpMax);
    if (p.hp <= 0) p.hp = stats.hpMax;
    this.players.set(member.pid, p);
    this.events.push({ t: 'padd', p: this.describePlayer(p) });
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.member.hp = p.hp; p.member.mp = p.mp;
    this.players.delete(pid);
    this.events.push({ t: 'pdel', id: p.id });
    for (const e of [...this.ents.values()]) if (e.owner === pid) this.ents.delete(e.id);
  }

  refreshStats(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.stats = p.member.derived(p.buffs);
    p.hp = Math.min(p.hp, p.stats.hpMax); p.mp = Math.min(p.mp, p.stats.mpMax);
    this.events.push({ t: 'look', id: p.id, look: p.member.look(), level: p.member.char.level, hpMax: p.stats.hpMax });
  }

  // Client-reported movement. Accept it unless it's faster than possible or inside a wall.
  onMove(pid, d) {
    const p = this.players.get(pid);
    if (!p || p.dead || p.dashing) return;
    const x = Number(d?.x); const y = Number(d?.y); const rot = Number(d?.rot);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dt = Math.max(0.05, this.time - p.lastPosAt);
    const speed = p.stats.moveSpeed * (p.slowUntil > this.time ? 0.6 : 1);
    const max = speed * dt * 1.35 + 0.6;
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > max || !this.map.walkableAt(x, y)) {
      // Too far or into a wall: walk as far as allowed and tell the client where it really is.
      const k = Math.min(1, max / Math.max(dist, 1e-6));
      const np = moveCircle(this.map, p.x, p.y, (x - p.x) * k, (y - p.y) * k, p.r);
      p.x = np.x; p.y = np.y;
      this.party.emitTo(pid, 'correct', { x: r2(p.x), y: r2(p.y) });
    } else {
      p.x = x; p.y = y;
    }
    if (Number.isFinite(rot)) p.rot = rot;
    p.moved = dist;
    p.lastPosAt = this.time;
  }

  // ------------------------------------------------------------ combat: players
  canAct(p) { return p && !p.dead && !p.dashing; }

  onAttack(pid, d) {
    const p = this.players.get(pid);
    if (!this.canAct(p)) return;
    if ((p.cds.atk || 0) > this.time + 0.06) return;
    p.cds.atk = this.time + p.stats.atkInterval * 0.92;
    if (Number.isFinite(d?.rot)) p.rot = d.rot;
    this.events.push({ t: 'act', id: p.id, a: 'swing', rot: r2(p.rot), n: d?.n | 0 });
    this.meleeHit(p, { range: p.stats.reach, arc: 120, mult: 1 });
  }

  onSkill(pid, d) {
    const p = this.players.get(pid);
    if (!this.canAct(p)) return;
    const id = String(d?.id || '');
    const sk = SKILLS[id];
    const rank = p.member.char.skills?.[id] || 0;
    if (!sk || rank < 1) return;
    if ((p.cds[id] || 0) > this.time + 0.06) return;
    const cost = sk.mana(rank);
    if (p.mp < cost) { this.party.emitTo(pid, 'msg', { text: 'Not enough mana', kind: 'warn' }); return; }
    p.mp -= cost;
    p.cds[id] = this.time + sk.cd;
    p.cds.atk = this.time + 0.35;
    if (Number.isFinite(d?.rot)) p.rot = d.rot;
    this.events.push({ t: 'act', id: p.id, a: id, rot: r2(p.rot) });
    if (id === 'cleave') this.meleeHit(p, { range: sk.range, arc: sk.arc, mult: sk.mult(rank) });
    if (id === 'bash') this.meleeHit(p, { range: sk.range, arc: sk.arc, mult: sk.mult(rank), stun: sk.stun(rank), knock: 2.6 });
    if (id === 'charge') {
      const dist = sk.dist(rank);
      const fx = Math.sin(p.rot); const fy = Math.cos(p.rot);
      const from = { x: p.x, y: p.y };
      const to = moveCircle(this.map, p.x, p.y, fx * dist, fy * dist, p.r);
      p.x = to.x; p.y = to.y; p.lastPosAt = this.time;
      // Brief window where client position reports are ignored while the dash plays out.
      p.dashing = true;
      setTimeout(() => { p.dashing = false; }, 260);
      this.events.push({ t: 'dash', id: p.id, fx: r2(from.x), fy: r2(from.y), x: r2(to.x), y: r2(to.y) });
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 0.01;
      for (const m of this.targetsNear(from.x, from.y, len + 2)) {
        // distance from the dash line
        const t = Math.max(0, Math.min(1, ((m.x - from.x) * (to.x - from.x) + (m.y - from.y) * (to.y - from.y)) / (len * len)));
        const px = from.x + (to.x - from.x) * t; const py = from.y + (to.y - from.y) * t;
        if (Math.hypot(m.x - px, m.y - py) <= 1.3 + m.r) this.damageTarget(p, m, sk.mult(rank), { stun: 0.6 });
      }
    }
    if (id === 'warcry') {
      const buff = { dmg: sk.dmg(rank), armor: sk.armor(rank), until: this.time + sk.dur };
      for (const q of this.players.values()) {
        if (q.dead || Math.hypot(q.x - p.x, q.y - p.y) > sk.radius) continue;
        q.buffs.warcry = buff;
        q.stats = q.member.derived(q.buffs);
        this.party.emitTo(q.pid, 'buff', { id: 'warcry', dur: sk.dur });
      }
      for (const m of this.targetsNear(p.x, p.y, sk.radius)) {
        if (m.k !== 'm') continue;
        m.slowUntil = this.time + 4;
        this.aggro(m, p);
      }
      this.events.push({ t: 'fx', k: 'warcry', x: r1(p.x), y: r1(p.y), r: sk.radius });
    }
  }

  targetsNear(x, y, rad) {
    const out = [];
    for (const e of this.ents.values()) {
      if (e.k === 'm' && e.state !== 'dead' && Math.hypot(e.x - x, e.y - y) <= rad + e.r) out.push(e);
      else if (e.k === 'b' && Math.hypot(e.x - x, e.y - y) <= rad + e.r) out.push(e);
    }
    return out;
  }

  meleeHit(p, { range, arc, mult, stun = 0, knock = 0 }) {
    const half = (arc / 2) * Math.PI / 180;
    let hits = 0;
    for (const e of this.targetsNear(p.x, p.y, range)) {
      const ang = Math.atan2(e.x - p.x, e.y - p.y);
      const dist = Math.hypot(e.x - p.x, e.y - p.y);
      // Things right against you always get hit, whatever the facing.
      if (dist > e.r + 0.7 && Math.abs(angDiff(ang, p.rot)) > half) continue;
      if (!lineOfSight(this.map, p.x, p.y, e.x, e.y)) continue;
      this.damageTarget(p, e, mult, { stun, knock });
      hits++;
    }
    return hits;
  }

  damageTarget(p, e, mult, { stun = 0, knock = 0 } = {}) {
    if (e.k === 'b') { this.breakBreakable(e, p); return; }
    const s = p.stats;
    let dmg = this.rng.int(s.dmg[0], s.dmg[1]) * mult;
    const crit = this.rng.chance(s.crit / 100);
    if (crit) dmg *= 1.75;
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg;
    this.events.push({ t: 'dmg', id: e.id, v: dmg, c: crit ? 1 : 0, hp: Math.max(0, e.hp) });
    if (s.lifeSteal && p.hp > 0) p.hp = Math.min(s.hpMax, p.hp + dmg * s.lifeSteal / 100);
    if (e.hp <= 0) { this.killMonster(e, p); return; }
    this.aggro(e, p);
    const stunFor = stun || (s.stunChance && this.rng.chance(s.stunChance) ? 0.8 : 0);
    if (stunFor && !e.boss) { e.stunUntil = this.time + stunFor; if (e.state === 'windup') e.state = 'chase'; }
    else if (stunFor && e.boss) e.stunUntil = this.time + stunFor * 0.25;
    if (knock && !e.boss) {
      const a = Math.atan2(e.x - p.x, e.y - p.y);
      const np = moveCircle(this.map, e.x, e.y, Math.sin(a) * knock, Math.cos(a) * knock, e.r);
      e.x = np.x; e.y = np.y;
    }
    // Light hit-stagger on small monsters makes melee feel weighty.
    if (!e.boss && !e.elite && e.state === 'windup' && this.rng.chance(0.25)) { e.state = 'chase'; e.t = 0; }
  }

  aggro(m, p) {
    if (m.k !== 'm' || m.state === 'dead') return;
    if (m.state === 'idle') {
      m.state = 'chase'; m.target = p.pid;
      // Wake the pack.
      for (const o of this.ents.values()) {
        if (o.k === 'm' && o.state === 'idle' && Math.hypot(o.x - m.x, o.y - m.y) < 5 && lineOfSight(this.map, m.x, m.y, o.x, o.y)) { o.state = 'chase'; o.target = p.pid; }
      }
    }
    if (!m.target || this.rng.chance(0.3)) m.target = p.pid;
  }

  killMonster(m, killer) {
    m.state = 'dead'; m.hp = 0;
    this.events.push({ t: 'die', id: m.id });
    setTimeout(() => this.ents.delete(m.id), 100);
    const xpShare = this.players.size > 1 ? 1.1 : 1; // small co-op bonus, everyone gets full XP
    for (const p of this.players.values()) {
      if (Math.hypot(p.x - m.x, p.y - m.y) > 60) continue;
      this.party.grantXp(p.pid, Math.round(m.xp * xpShare));
      p.member.char.kills = (p.member.char.kills || 0) + 1;
      this.rollLoot(p, m.x, m.y, m.boss ? 'boss' : m.elite ? 'elite' : 'mob', m);
    }
    if (m.boss) {
      this.bossAlive = [...this.ents.values()].some((e) => e.k === 'm' && e.boss && e.state !== 'dead');
      if (!this.bossAlive) {
        this.events.push({ t: 'msg', text: `${m.name} has fallen! The stairs are open.`, kind: 'good' });
        this.events.push({ t: 'boss', alive: false });
      }
    }
  }

  breakBreakable(b, p) {
    this.events.push({ t: 'break', id: b.id });
    this.ents.delete(b.id);
    for (const q of this.players.values()) if (Math.hypot(q.x - b.x, q.y - b.y) < 30) this.rollLoot(q, b.x, b.y, 'breakable');
  }

  rollLoot(p, x, y, source, mob = null) {
    const rng = this.rng;
    const floor = Math.max(1, this.spec.floor);
    const drops = [];
    const gf = 1 + (p.stats.goldFind || 0) / 100;
    const gold = () => Math.max(1, Math.round(rng.int(3, 9) * (1 + floor * 0.4) * gf));
    if (source === 'mob') {
      if (rng.chance(0.06)) drops.push({ mat: 'scrap', n: rng.int(1, 2) });
      if (rng.chance(0.42)) drops.push({ gold: gold() });
      if (rng.chance(0.11)) drops.push({ item: randomItem(rng, floor + rng.int(0, 2), 0) });
      if (rng.chance(0.07)) drops.push({ potion: rng.chance(0.7) ? 'hp' : 'mp' });
    } else if (source === 'elite') {
      drops.push({ gold: gold() * 3 });
      drops.push({ mat: 'scrap', n: rng.int(1, 3) });
      if (rng.chance(0.4)) drops.push({ mat: 'dust', n: 1 });
      if (rng.chance(0.75)) drops.push({ item: randomItem(rng, floor + rng.int(1, 3), 1) });
      if (rng.chance(0.3)) drops.push({ item: randomItem(rng, floor + rng.int(1, 3), 1) });
      if (rng.chance(0.3)) drops.push({ potion: 'hp' });
    } else if (source === 'boss') {
      drops.push({ gold: gold() * 10 });
      for (let i = 0; i < 3; i++) drops.push({ item: randomItem(rng, floor + 3, 2) });
      drops.push({ potion: 'hp' }, { potion: 'mp' });
      // Boss-only crafting materials
      drops.push({ mat: 'sigil', n: 1 });
      const trophy = BOSS_TROPHY[mob?.type];
      if (trophy) drops.push({ mat: trophy, n: rng.chance(0.35) ? 2 : 1 });
    } else if (source === 'breakable') {
      if (rng.chance(0.25)) drops.push({ mat: 'scrap', n: 1 });
      if (rng.chance(0.45)) drops.push({ gold: Math.ceil(gold() * 0.6) });
      if (rng.chance(0.12)) drops.push({ potion: rng.chance(0.65) ? 'hp' : 'mp' });
      if (rng.chance(0.05)) drops.push({ item: randomItem(rng, floor, 0) });
    } else if (source === 'chest' || source === 'bossChest') {
      drops.push({ gold: gold() * (source === 'bossChest' ? 6 : 3) });
      const n = source === 'bossChest' ? 3 : rng.int(1, 3);
      for (let i = 0; i < n; i++) drops.push({ item: randomItem(rng, floor + rng.int(0, 2) + (source === 'bossChest' ? 2 : 0), source === 'bossChest' ? 2 : 1) });
      if (rng.chance(0.5)) drops.push({ potion: 'hp' });
    }
    drops.forEach((d, i) => {
      const a = rng.float(0, Math.PI * 2) + i; const dist = rng.float(0.4, 1.4);
      let lx = x + Math.sin(a) * dist; let ly = y + Math.cos(a) * dist;
      if (!this.map.walkableAt(lx, ly)) { lx = x; ly = y; }
      this.addEnt({ id: eid('l'), k: 'l', owner: p.pid, x: lx, y: ly, ...d, born: this.time });
    });
  }

  // A player dropped an item from their pack: it lies at their feet (only they can see it).
  dropItem(pid, item) {
    const p = this.players.get(pid);
    if (!p) return false;
    const a = this.rng.float(0, Math.PI * 2);
    let x = p.x + Math.sin(a) * 0.9; let y = p.y + Math.cos(a) * 0.9;
    if (!this.map.walkableAt(x, y)) { x = p.x; y = p.y; }
    this.addEnt({ id: eid('l'), k: 'l', owner: pid, x, y, item, born: this.time, dropped: true });
    return true;
  }

  onPickup(pid, d) {
    const p = this.players.get(pid);
    if (!p || p.dead) return;
    const e = this.ents.get(String(d?.id || ''));
    if (!e || e.k !== 'l' || e.owner !== pid) return;
    if (Math.hypot(e.x - p.x, e.y - p.y) > 3.2) return;
    this.takeLoot(p, e);
  }

  takeLoot(p, e) {
    const ch = p.member.char;
    if (e.gold) { ch.gold += e.gold; this.party.emitTo(p.pid, 'gold', { gold: ch.gold, got: e.gold }); }
    else if (e.mat && MATERIALS[e.mat]) {
      ch.mats ||= {};
      ch.mats[e.mat] = (ch.mats[e.mat] || 0) + e.n;
      this.party.emitTo(p.pid, 'mats', { mats: ch.mats, got: { mat: e.mat, n: e.n } });
    }
    else if (e.potion) {
      if (ch.potions[e.potion] >= MAX_POTIONS) { this.party.emitTo(p.pid, 'msg', { text: 'Potion belt is full', kind: 'warn' }); return; }
      ch.potions[e.potion]++;
      this.party.emitTo(p.pid, 'potions', ch.potions);
    } else if (e.item) {
      const slot = ch.inv.findIndex((x) => !x);
      if (slot < 0) { this.party.emitTo(p.pid, 'msg', { text: 'Your pack is full', kind: 'warn' }); return; }
      ch.inv[slot] = e.item;
      this.party.emitTo(p.pid, 'inv', { inv: ch.inv, got: e.item });
    }
    p.member.dirty = true;
    this.delEnt(e.id);
  }

  onPotion(pid, d) {
    const p = this.players.get(pid);
    if (!p || p.dead || this.time < p.potionAt) return;
    const kind = d?.kind === 'mp' ? 'mp' : 'hp';
    const ch = p.member.char;
    if (!ch.potions[kind]) { this.party.emitTo(pid, 'msg', { text: `No ${kind === 'hp' ? 'health' : 'mana'} potions`, kind: 'warn' }); return; }
    ch.potions[kind]--;
    p.potionAt = this.time + 0.8;
    if (kind === 'hp') p.hp = Math.min(p.stats.hpMax, p.hp + p.stats.hpMax * 0.5);
    else p.mp = Math.min(p.stats.mpMax, p.mp + p.stats.mpMax * 0.6);
    p.member.dirty = true;
    this.party.emitTo(pid, 'potions', ch.potions);
    this.events.push({ t: 'fx', k: kind === 'hp' ? 'heal' : 'mana', id: p.id });
  }

  // Stairs, chests, the town gate, NPCs.
  onInteract(pid, d) {
    const p = this.players.get(pid);
    if (!p || p.dead) return;
    const near = (o, r) => Math.hypot(o.x - p.x, o.y - p.y) <= r;
    if (d?.id) {
      const e = this.ents.get(String(d.id));
      if (e?.k === 'c' && !e.open && near(e, 3)) {
        if (e.boss && this.bossAlive) { this.party.emitTo(pid, 'msg', { text: 'The chest is sealed while the guardian lives', kind: 'warn' }); return; }
        e.open = true;
        this.events.push({ t: 'open', id: e.id });
        for (const q of this.players.values()) this.rollLoot(q, e.x + Math.sin(e.rot) * 1.2, e.y + Math.cos(e.rot) * 1.2, e.boss ? 'bossChest' : 'chest');
        return;
      }
      if (e?.k === 'l') return this.onPickup(pid, d);
    }
    const m = this.map;
    if (m.kind === 'dungeon' && m.exit && near(m.exit, 2.6)) {
      if (this.bossAlive) { this.party.emitTo(pid, 'msg', { text: 'A dark power seals the stairs. Defeat the guardian!', kind: 'warn' }); return; }
      this.party.requestTravel(pid, { kind: 'dungeon', floor: this.spec.floor + 1 });
      return;
    }
    if (m.kind === 'dungeon' && m.entry && near(m.entry, 2.6)) { this.party.requestTravel(pid, { kind: 'town' }); return; }
    if (m.kind === 'town' && m.exit && near(m.exit, 4)) { this.party.openGate(pid); return; }
    const npc = m.npcs.map((n) => [n, Math.hypot(n.x - p.x, n.y - p.y)]).filter(([, d]) => d <= 3.5).sort((a, b) => a[1] - b[1])[0];
    if (npc) { this.party.openShop(pid, npc[0].id); return; }
  }

  // ------------------------------------------------------------ monsters
  updateField() {
    const alive = [...this.players.values()].filter((p) => !p.dead);
    this.field = alive.length ? distanceField(this.map, alive, 48) : null;
  }

  nearestPlayer(m, maxD) {
    let best = null; let bd = maxD;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  stepToward(m, tx, ty, speed, dt) {
    const dx = tx - m.x; const dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return;
    const s = Math.min(d, speed * dt);
    const np = moveCircle(this.map, m.x, m.y, (dx / d) * s, (dy / d) * s, m.r);
    m.x = np.x; m.y = np.y;
    m.rot = Math.atan2(dx, dy);
  }

  // Follow the distance field downhill toward the nearest player.
  pathStep(m, target, speed, dt) {
    const direct = Math.hypot(target.x - m.x, target.y - m.y) < 9 && lineOfSight(this.map, m.x, m.y, target.x, target.y);
    if (direct || !this.field) return this.stepToward(m, target.x, target.y, speed, dt);
    const { w } = this.map;
    const tx = toTile(m.x); const ty = toTile(m.y);
    let best = null; let bd = this.field[ty * w + tx];
    if (bd < 0) bd = 9999;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox; const ny = ty + oy;
        if (!this.map.walkable(nx, ny)) continue;
        if (ox && oy && (!this.map.walkable(tx + ox, ty) || !this.map.walkable(tx, ty + oy))) continue;
        const v = this.field[ny * w + nx];
        if (v >= 0 && v < bd) { bd = v; best = [nx, ny]; }
      }
    }
    if (best) this.stepToward(m, best[0] * TILE + TILE / 2, best[1] * TILE + TILE / 2, speed, dt);
    else this.stepToward(m, target.x, target.y, speed, dt);
  }

  hurtPlayer(p, amount, src) {
    if (p.dead) return;
    const s = p.stats;
    if (s.block && this.rng.chance(s.block / 100)) {
      this.events.push({ t: 'dmg', id: p.id, v: 0, b: 1 });
      return;
    }
    const lvl = src?.level || Math.max(1, this.spec.floor);
    const dmg = Math.max(1, Math.round(amount * (1 - armorReduction(s.armor, lvl))));
    p.hp -= dmg;
    this.events.push({ t: 'dmg', id: p.id, v: dmg, hp: Math.max(0, Math.ceil(p.hp)) });
    if (p.hp <= 0) this.killPlayer(p);
  }

  killPlayer(p) {
    p.dead = true; p.hp = 0; p.respawnAt = this.time + RESPAWN_S;
    const ch = p.member.char;
    const lost = Math.floor(ch.gold * 0.1);
    ch.gold -= lost; ch.deaths = (ch.deaths || 0) + 1;
    p.member.dirty = true;
    this.events.push({ t: 'pdie', id: p.id });
    this.party.emitTo(p.pid, 'died', { lost, respawn: RESPAWN_S, gold: ch.gold });
    for (const m of this.ents.values()) if (m.k === 'm' && m.target === p.pid) m.target = null;
  }

  monsterAttack(m, d) {
    const st = MONSTERS[m.type];
    if (st.ranged) {
      const t = this.players.get(m.target);
      if (!t || t.dead) return;
      // Lead the target a little.
      const dist = Math.hypot(t.x - m.x, t.y - m.y);
      const lead = Math.min(0.6, dist / st.ranged.speed) * 0.5;
      const tx = t.x + (t.vx || 0) * lead; const ty = t.y + (t.vy || 0) * lead;
      const a = Math.atan2(tx - m.x, ty - m.y);
      m.rot = a;
      this.addEnt({ id: eid('x'), k: 'x', kind: st.ranged.kind, x: m.x + Math.sin(a) * 0.6, y: m.y + Math.cos(a) * 0.6, vx: Math.sin(a) * st.ranged.speed, vy: Math.cos(a) * st.ranged.speed, dmg: m.dmg, level: m.level, life: 1.6 });
      return;
    }
    const half = ((st.arc || 90) / 2) * Math.PI / 180;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const dist = Math.hypot(p.x - m.x, p.y - m.y);
      if (dist > st.range + p.r + 0.35) continue;
      const ang = Math.atan2(p.x - m.x, p.y - m.y);
      if (dist > p.r + m.r + 0.3 && Math.abs(angDiff(ang, m.rot)) > half) continue;
      this.hurtPlayer(p, m.dmg, m);
      if (!m.boss) break; // regular monsters hit one target
    }
  }

  updateMonster(m, dt) {
    const st = MONSTERS[m.type];
    const now = this.time;
    if (m.state === 'dead') return;
    const near = this.nearestPlayer(m, SLEEP_DIST);
    if (!near && m.state === 'idle') return; // asleep
    if (m.stunUntil > now) return;
    const speed = m.speed * (m.slowUntil > now ? 0.55 : 1);

    if (m.state === 'idle') {
      m.think -= dt;
      if (m.think > 0) return;
      m.think = 0.4;
      if (near && Math.hypot(near.x - m.x, near.y - m.y) < st.aggro && lineOfSight(this.map, m.x, m.y, near.x, near.y)) this.aggro(m, near);
      return;
    }

    let target = this.players.get(m.target);
    if (!target || target.dead) { target = near; m.target = near?.pid || null; }
    if (!target) { m.state = 'idle'; return; }
    const dist = Math.hypot(target.x - m.x, target.y - m.y);
    if (dist > 45) { m.state = 'idle'; m.target = null; return; }

    // Boss abilities
    if (m.boss && st.slam && m.state !== 'windup' && m.state !== 'slam') {
      m.slamAt -= dt;
      if (m.slamAt <= 0 && dist < st.slam.radius + 3) {
        m.state = 'slam'; m.t = st.slam.tell; m.slamAt = st.slam.every;
        this.events.push({ t: 'tell', id: m.id, x: r1(m.x), y: r1(m.y), r: st.slam.radius, dur: st.slam.tell });
        this.events.push({ t: 'act', id: m.id, a: 'slam' });
        return;
      }
      const frac = m.hp / m.hpMax;
      const wave = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
      if (wave > m.summoned) {
        m.summoned = wave;
        const n = st.summon === 'spiderling' ? 6 : 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const sx = m.x + Math.sin(a) * 3; const sy = m.y + Math.cos(a) * 3;
          if (!this.map.walkableAt(sx, sy)) continue;
          const s = this.spawnMonster(st.summon, sx, sy, { partySize: this.players.size });
          s.state = 'chase'; s.target = target.pid;
        }
        this.events.push({ t: 'fx', k: 'summon', x: r1(m.x), y: r1(m.y), r: 3 });
        this.events.push({ t: 'msg', text: `${m.name} calls for aid!`, kind: 'warn' });
      }
    }

    if (m.state === 'slam') {
      m.t -= dt;
      if (m.t <= 0) {
        for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - m.x, p.y - m.y) <= st.slam.radius + p.r) this.hurtPlayer(p, m.dmg * st.slam.mult, m);
        this.events.push({ t: 'fx', k: 'slam', x: r1(m.x), y: r1(m.y), r: st.slam.radius });
        m.state = 'recover'; m.t = 0.9;
      }
      return;
    }

    if (m.state === 'windup') {
      m.t -= dt;
      if (!st.ranged && target) m.rot += Math.max(-dt * 4, Math.min(dt * 4, angDiff(Math.atan2(target.x - m.x, target.y - m.y), m.rot)));
      if (m.t <= 0) { this.monsterAttack(m, dist); m.state = 'recover'; m.t = Math.max(0.15, st.cd - st.windup); }
      return;
    }
    if (m.state === 'recover') { m.t -= dt; if (m.t <= 0) m.state = 'chase'; return; }

    // chase
    const canSee = dist < 14 && lineOfSight(this.map, m.x, m.y, target.x, target.y);
    if (st.ranged) {
      if (canSee && dist <= st.range) {
        if (dist < st.ranged.keep) {
          // Back away while keeping line of sight.
          const a = Math.atan2(m.x - target.x, m.y - target.y);
          this.stepToward(m, m.x + Math.sin(a) * 2, m.y + Math.cos(a) * 2, speed * 0.8, dt);
          m.rot = a + Math.PI;
        }
        if (now >= m.cdUntil) {
          m.state = 'windup'; m.t = st.windup; m.cdUntil = now + st.cd;
          m.rot = Math.atan2(target.x - m.x, target.y - m.y);
          this.events.push({ t: 'act', id: m.id, a: 'shoot' });
        }
        return;
      }
      this.pathStep(m, target, speed, dt);
      return;
    }
    if (dist <= st.range + target.r * 0.5 && canSee) {
      m.rot = Math.atan2(target.x - m.x, target.y - m.y);
      if (now >= m.cdUntil) {
        m.state = 'windup'; m.t = st.windup; m.cdUntil = now + st.cd;
        this.events.push({ t: 'act', id: m.id, a: 'attack' });
      }
      return;
    }
    this.pathStep(m, target, speed, dt);
  }

  separate(dt) {
    const ms = [];
    for (const e of this.ents.values()) if (e.k === 'm' && e.state !== 'dead' && e.state !== 'idle') ms.push(e);
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        const ax = (dx / d) * push; const ay = (dy / d) * push;
        const wa = a.boss ? 0.1 : 1; const wb = b.boss ? 0.1 : 1;
        let np = moveCircle(this.map, a.x, a.y, -ax * wa, -ay * wa, a.r); a.x = np.x; a.y = np.y;
        np = moveCircle(this.map, b.x, b.y, ax * wb, ay * wb, b.r); b.x = np.x; b.y = np.y;
      }
      // Monsters don't stand inside players.
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const dx = a.x - p.x; const dy = a.y - p.y;
        const rr = a.r + p.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const np = moveCircle(this.map, a.x, a.y, (dx / d) * (rr - d), (dy / d) * (rr - d), a.r);
        a.x = np.x; a.y = np.y;
      }
    }
  }

  updateProjectiles(dt) {
    for (const e of [...this.ents.values()]) {
      if (e.k !== 'x') continue;
      e.life -= dt;
      const nx = e.x + e.vx * dt; const ny = e.y + e.vy * dt;
      let hit = false;
      if (!this.map.walkableAt(nx, ny) || e.life <= 0) hit = true;
      else {
        for (const p of this.players.values()) {
          if (p.dead) continue;
          if (Math.hypot(p.x - nx, p.y - ny) <= p.r + 0.3) { this.hurtPlayer(p, e.dmg, e); hit = true; break; }
        }
      }
      e.x = nx; e.y = ny;
      if (hit) { this.events.push({ t: 'fx', k: e.kind === 'fireball' ? 'burst' : 'spark', x: r1(nx), y: r1(ny) }); this.delEnt(e.id); }
    }
  }

  // ------------------------------------------------------------ main loop
  tick() {
    const dt = TICK;
    this.time += dt;
    this.tickN++;
    const now = this.time;

    for (const p of this.players.values()) {
      // velocity estimate for monster aiming
      p.vx = ((p.x - (p.px ?? p.x)) / dt) * 0.5 + (p.vx || 0) * 0.5;
      p.vy = ((p.y - (p.py ?? p.y)) / dt) * 0.5 + (p.vy || 0) * 0.5;
      p.px = p.x; p.py = p.y;
      if (p.dead) {
        if (now >= p.respawnAt) {
          p.dead = false; p.hp = p.stats.hpMax; p.mp = p.stats.mpMax;
          p.x = this.map.start.x; p.y = this.map.start.y;
          this.events.push({ t: 'prespawn', id: p.id, x: r1(p.x), y: r1(p.y) });
          this.party.emitTo(p.pid, 'correct', { x: p.x, y: p.y, force: true });
        }
        continue;
      }
      if (p.buffs.warcry && p.buffs.warcry.until < now) { delete p.buffs.warcry; p.stats = p.member.derived(p.buffs); }
      p.hp = Math.min(p.stats.hpMax, p.hp + p.stats.hpRegen * dt * (this.spec.kind === 'town' ? 20 : 1));
      p.mp = Math.min(p.stats.mpMax, p.mp + p.stats.mpRegen * dt * (this.spec.kind === 'town' ? 10 : 1));
      // Auto-pickup gold and potions you walk over.
      for (const e of this.ents.values()) {
        if (e.k === 'l' && e.owner === p.pid && !e.item && Math.hypot(e.x - p.x, e.y - p.y) < 1.4) this.takeLoot(p, e);
      }
    }

    if (this.spec.kind === 'dungeon') {
      if (now >= this.fieldAt) { this.updateField(); this.fieldAt = now + 0.35; }
      for (const e of this.ents.values()) if (e.k === 'm') this.updateMonster(e, dt);
      this.separate(dt);
      this.updateProjectiles(dt);
    }

    // Old loot fades away after 5 minutes.
    if (this.tickN % 100 === 0) for (const e of [...this.ents.values()]) if (e.k === 'l' && now - e.born > 300) this.delEnt(e.id);

    if (this.tickN % this.snapEvery === 0) this.sendSnap();
  }

  sendSnap() {
    const ps = [];
    for (const p of this.players.values()) ps.push([p.id, r2(p.x), r2(p.y), r2(p.rot), Math.ceil(p.hp), p.stats.hpMax, Math.floor(p.mp), p.stats.mpMax, p.dead ? 1 : 0]);
    const ms = [];
    const players = [...this.players.values()];
    for (const e of this.ents.values()) {
      if (e.k !== 'm' || e.state === 'dead') continue;
      if (e.state === 'idle' && !players.some((p) => Math.hypot(p.x - e.x, p.y - e.y) < 50)) continue;
      const st = e.state === 'windup' || e.state === 'slam' ? 2 : e.stunUntil > this.time ? 3 : e.state === 'idle' ? 0 : 1;
      ms.push([e.id, r1(e.x), r1(e.y), r2(e.rot), Math.max(0, Math.round(e.hp)), st]);
    }
    const ev = this.events; this.events = [];
    this.party.broadcast('snap', { t: r2(this.time), p: ps, m: ms, ev });
  }
}
