// One live area for a party: the town or a dungeon floor. Runs monsters, combat and loot.
// The server is the authority for damage, deaths, drops and XP; players move themselves
// (client-side prediction) and the server checks those moves.
import { buildMap, moveCircle, lineOfSight, distanceField, toTile, TILE, isBossFloor } from '../shared/map.js';
import { RNG, hashSeed } from '../shared/rng.js';
import { DUEL, settleDuel } from './duel.js';
import { MONSTERS, SKILLS, CLASSES, monsterStats, armorReduction, randomItem, makeItem, MAX_POTIONS, MATERIALS, BOSS_TROPHY } from '../shared/rules.js';

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
    this.timers = []; // [time, fn] for delayed hits (Frenzy's second strike, Whirlwind pulses)
    this.areas = []; // lingering ground effects (Acid Pool)
    this.duel = null; // { a, b, stake, state: 'countdown'|'fight', at, ends }
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
      case 'w': return { id: e.id, k: 'w', type: 'wolf', x: r1(e.x), y: r1(e.y), rot: r2(e.rot), name: e.name };
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
    for (const e of [...this.ents.values()]) if (e.k === 'w' && e.by === pid) this.delEnt(e.id);
    this.areas = this.areas.filter((a) => a.by !== pid);
    if (this.duel && (this.duel.a === pid || this.duel.b === pid)) this.endDuel(this.duel.a === pid ? this.duel.b : this.duel.a, 'left');
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
    if (this.duel?.state === 'countdown' && (this.duel.a === pid || this.duel.b === pid)) { this.party.emitTo(pid, 'correct', { x: r2(p.x), y: r2(p.y) }); return; }
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
  canAct(p) { return p && !p.dead && !p.dashing && !(this.duel?.state === 'countdown' && (this.duel.a === p.pid || this.duel.b === p.pid)); }

  onAttack(pid, d) {
    const p = this.players.get(pid);
    if (!this.canAct(p)) return;
    if ((p.cds.atk || 0) > this.time + 0.06) return;
    p.cds.atk = this.time + p.stats.atkInterval * 0.92;
    if (Number.isFinite(d?.rot)) p.rot = d.rot;
    if (CLASSES[p.cls]?.ranged) {
      // Alchemist: a quick arcane bolt instead of a swing.
      this.events.push({ t: 'act', id: p.id, a: 'throw', rot: r2(p.rot) });
      this.shoot(p, 'bolt', p.rot, { speed: 17, life: 0.75, mult: 0.9 });
      return;
    }
    this.events.push({ t: 'act', id: p.id, a: 'swing', rot: r2(p.rot), n: d?.n | 0 });
    this.meleeHit(p, { range: p.stats.reach, arc: 120, mult: 1 });
  }

  onSkill(pid, d) {
    const p = this.players.get(pid);
    if (!this.canAct(p)) return;
    const id = String(d?.id || '');
    const sk = SKILLS[id];
    const rank = p.member.char.skills?.[id] || 0;
    if (!sk || rank < 1 || !CLASSES[p.cls]?.skills.includes(id)) return;
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
    this.classSkill(p, id, sk, rank);
  }

  // ------------------------------------------------------------ Berserker / Alchemist / Druid skills
  classSkill(p, id, sk, rank) {
    const fx = Math.sin(p.rot); const fy = Math.cos(p.rot);
    switch (id) {
      case 'frenzy':
        this.meleeHit(p, { range: Math.max(sk.range, p.stats.reach + 0.3), arc: sk.arc, mult: sk.mult(rank) });
        this.after(0.16, () => { if (!p.dead && this.players.get(p.pid) === p) this.meleeHit(p, { range: Math.max(sk.range, p.stats.reach + 0.3), arc: sk.arc, mult: sk.mult(rank) }); });
        break;
      case 'leap': {
        const from = { x: p.x, y: p.y };
        const to = moveCircle(this.map, p.x, p.y, fx * sk.dist(rank), fy * sk.dist(rank), p.r);
        p.x = to.x; p.y = to.y; p.lastPosAt = this.time;
        p.dashing = true;
        this.events.push({ t: 'dash', id: p.id, fx: r2(from.x), fy: r2(from.y), x: r2(to.x), y: r2(to.y), leap: 1 });
        this.after(0.36, () => {
          p.dashing = false;
          if (p.dead || this.players.get(p.pid) !== p) return;
          this.events.push({ t: 'fx', k: 'leap', x: r1(to.x), y: r1(to.y), r: sk.radius });
          for (const e of this.targetsNear(to.x, to.y, sk.radius)) this.damageTarget(p, e, sk.mult(rank), { stun: sk.stun, knock: 1.2 });
        });
        break;
      }
      case 'whirlwind':
        for (let i = 0; i < sk.pulses; i++) {
          this.after(i * 0.2, () => {
            if (p.dead || this.players.get(p.pid) !== p) return;
            for (const e of this.targetsNear(p.x, p.y, sk.radius)) if (lineOfSight(this.map, p.x, p.y, e.x, e.y)) this.damageTarget(p, e, sk.mult(rank));
          });
        }
        break;
      case 'bloodlust':
        p.buffs.bloodlust = { atkSpd: sk.atkSpd(rank), lifeSteal: sk.lifeSteal(rank), until: this.time + sk.dur };
        p.stats = p.member.derived(p.buffs);
        this.party.emitTo(p.pid, 'buff', { id: 'bloodlust', dur: sk.dur });
        this.events.push({ t: 'fx', k: 'bloodlust', id: p.id });
        break;
      case 'flask':
        this.shoot(p, 'flask', p.rot, { speed: sk.speed, life: sk.life, mult: sk.mult(rank), aoe: sk.radius });
        break;
      case 'nova':
        this.events.push({ t: 'fx', k: 'nova', x: r1(p.x), y: r1(p.y), r: sk.radius });
        for (const e of this.targetsNear(p.x, p.y, sk.radius)) {
          if (e.k === 'm') e.slowUntil = this.time + sk.stun(rank) + 3;
          this.damageTarget(p, e, sk.mult(rank), { stun: sk.stun(rank) });
        }
        break;
      case 'acid': {
        const at = moveCircle(this.map, p.x, p.y, fx * sk.dist, fy * sk.dist, 0.3);
        this.areas.push({ kind: 'acid', x: at.x, y: at.y, r: sk.radius, until: this.time + sk.dur, next: this.time + 0.1, every: 0.5, by: p.pid, mult: sk.mult(rank) });
        this.events.push({ t: 'fx', k: 'acid', x: r1(at.x), y: r1(at.y), r: sk.radius, dur: sk.dur });
        break;
      }
      case 'ward': {
        const absorb = sk.absorb(rank, p.stats.spi);
        for (const q of this.players.values()) {
          if (q.dead || Math.hypot(q.x - p.x, q.y - p.y) > sk.radius) continue;
          q.buffs.ward = { hp: absorb, until: this.time + sk.dur };
          this.party.emitTo(q.pid, 'buff', { id: 'ward', dur: sk.dur, hp: absorb });
          this.events.push({ t: 'fx', k: 'ward', id: q.id, on: 1 });
        }
        break;
      }
      case 'thorns':
        for (let i = 0; i < sk.count; i++) {
          const a = p.rot + (i / (sk.count - 1) - 0.5) * sk.spread;
          this.shoot(p, 'thorn', a, { speed: sk.speed, life: sk.life, mult: sk.mult(rank) });
        }
        break;
      case 'entangle': {
        const at = moveCircle(this.map, p.x, p.y, fx * sk.dist, fy * sk.dist, 0.3);
        this.events.push({ t: 'fx', k: 'roots', x: r1(at.x), y: r1(at.y), r: sk.radius, dur: sk.stun(rank) });
        for (const e of this.targetsNear(at.x, at.y, sk.radius)) this.damageTarget(p, e, sk.mult(rank), { stun: sk.stun(rank) });
        break;
      }
      case 'wolf': {
        for (const e of [...this.ents.values()]) if (e.k === 'w' && e.by === p.pid) this.delEnt(e.id);
        const at = moveCircle(this.map, p.x, p.y, fx * 1.5, fy * 1.5, 0.4);
        this.addEnt({ id: eid('w'), k: 'w', by: p.pid, name: `${p.name}'s Wolf`, x: at.x, y: at.y, rot: p.rot, r: 0.4, until: this.time + sk.dur, mult: sk.mult(rank), target: null, atkAt: 0, speed: 6.6 });
        this.events.push({ t: 'fx', k: 'summon', x: r1(at.x), y: r1(at.y) });
        break;
      }
      case 'rejuv':
        for (const q of this.players.values()) {
          if (q.dead || Math.hypot(q.x - p.x, q.y - p.y) > sk.radius) continue;
          q.hp = Math.min(q.stats.hpMax, q.hp + q.stats.hpMax * 0.1);
          q.hot = { perSec: (q.stats.hpMax * sk.hot(rank)) / sk.dur, until: this.time + sk.dur };
          this.events.push({ t: 'fx', k: 'heal', id: q.id });
        }
        this.events.push({ t: 'fx', k: 'rejuv', x: r1(p.x), y: r1(p.y), r: sk.radius });
        break;
      default: break;
    }
  }

  after(delay, fn) { this.timers.push([this.time + delay, fn]); }

  // A player projectile (Alchemist bolt / flask, Druid thorns). `by` is the shooter's pid.
  shoot(p, kind, rot, { speed, life, mult, aoe = 0 }) {
    const sx = Math.sin(rot); const sy = Math.cos(rot);
    this.addEnt({ id: eid('x'), k: 'x', kind, by: p.pid, x: p.x + sx * 0.6, y: p.y + sy * 0.6, vx: sx * speed, vy: sy * speed, mult, aoe, life });
  }

  updateWolf(w, dt) {
    const owner = this.players.get(w.by);
    if (!owner || this.time >= w.until) { this.events.push({ t: 'fx', k: 'summon', x: r1(w.x), y: r1(w.y) }); this.delEnt(w.id); return; }
    // Pick the closest living monster near the wolf and its owner.
    let t = w.target ? this.ents.get(w.target) : null;
    if (!t || t.state === 'dead' || Math.hypot(t.x - owner.x, t.y - owner.y) > 14) {
      t = null; let bd = 10;
      for (const e of this.ents.values()) {
        if (e.k !== 'm' || e.state === 'dead' || e.state === 'idle' && Math.hypot(e.x - owner.x, e.y - owner.y) > 7) continue;
        const d = Math.hypot(e.x - w.x, e.y - w.y);
        if (d < bd && lineOfSight(this.map, w.x, w.y, e.x, e.y)) { bd = d; t = e; }
      }
      w.target = t?.id || null;
    }
    let gx; let gy; let stop;
    if (t) { gx = t.x; gy = t.y; stop = t.r + w.r + 0.5; } else { gx = owner.x - Math.sin(owner.rot) * 1.4; gy = owner.y - Math.cos(owner.rot) * 1.4; stop = 0.6; }
    const d = Math.hypot(gx - w.x, gy - w.y);
    if (d > 18) { w.x = owner.x; w.y = owner.y; return; } // got lost: catch up
    if (d > stop) {
      const st = Math.min(d - stop, w.speed * dt * (t ? 1 : Math.min(1.3, d / 2)));
      const np = moveCircle(this.map, w.x, w.y, (gx - w.x) / d * st, (gy - w.y) / d * st, w.r);
      w.x = np.x; w.y = np.y;
    }
    if (d > 0.05) w.rot = Math.atan2(gx - w.x, gy - w.y);
    if (t && d <= stop + 0.15 && this.time >= w.atkAt) {
      w.atkAt = this.time + 0.9;
      this.events.push({ t: 'act', id: w.id, a: 'attack', rot: r2(w.rot) });
      const keep = owner.stats;
      this.damageTarget(owner, t, w.mult);
      owner.stats = keep;
    }
  }

  targetsNear(x, y, rad) {
    const out = [];
    for (const e of this.ents.values()) {
      if (e.k === 'm' && e.state !== 'dead' && Math.hypot(e.x - x, e.y - y) <= rad + e.r) out.push(e);
      else if (e.k === 'b' && Math.hypot(e.x - x, e.y - y) <= rad + e.r) out.push(e);
    }
    if (this.duel?.state === 'fight') {
      for (const pid of [this.duel.a, this.duel.b]) {
        const q = this.players.get(pid);
        if (q && !q.dead && Math.hypot(q.x - x, q.y - y) <= rad + q.r) out.push(q);
      }
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
    if (e.k === 'p') { this.duelHit(p, e, mult); return; }
    const s = p.stats;
    let dmg = this.rng.int(s.dmg[0], s.dmg[1]) * mult;
    const crit = this.rng.chance(s.crit / 100);
    if (crit) dmg *= 1.75;
    // Elemental weapons add their damage to every hit (scaled like the hit itself).
    const el = s.elem || {};
    const elDmg = ((el.fire || 0) + (el.frost || 0) + (el.shock || 0) + (el.poison || 0)) * mult;
    const mainEl = el.fire ? 'fire' : el.frost ? 'frost' : el.shock ? 'shock' : el.poison ? 'poison' : 0;
    dmg = Math.max(1, Math.round(dmg + elDmg));
    e.hp -= dmg;
    this.events.push({ t: 'dmg', id: e.id, v: dmg, c: crit ? 1 : 0, hp: Math.max(0, e.hp), el: mainEl || undefined });
    if (s.lifeSteal && p.hp > 0) p.hp = Math.min(s.hpMax, p.hp + dmg * s.lifeSteal / 100);
    if (e.hp <= 0) { this.killMonster(e, p); return; }
    if (mainEl) this.applyElements(p, e, el, mult);
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

  // ------------------------------------------------------------ elemental effects
  applyElements(p, e, el, mult) {
    const now = this.time;
    if (el.fire) e.burn = { dps: el.fire * 0.5 * Math.max(0.5, mult), until: now + 2, by: p.pid };
    if (el.frost) { e.slowUntil = Math.max(e.slowUntil || 0, now + 1.5); e.chillUntil = now + 1.5; }
    if (el.poison) {
      const stacks = e.poison && e.poison.until > now ? Math.min(5, e.poison.stacks + 1) : 1;
      e.poison = { stacks, per: el.poison * 0.4, until: now + 3, by: p.pid };
    }
    if (el.shock && this.rng.chance(0.2)) {
      let best = null; let bd = 4.5;
      for (const o of this.ents.values()) {
        if (o.k !== 'm' || o === e || o.state === 'dead') continue;
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (d < bd && lineOfSight(this.map, e.x, e.y, o.x, o.y)) { bd = d; best = o; }
      }
      if (best) {
        this.events.push({ t: 'fx', k: 'zap', x: r1(e.x), y: r1(e.y), x2: r1(best.x), y2: r1(best.y) });
        this.rawDamage(p, best, Math.round(el.shock * 2), 'shock');
      }
    }
  }

  // Damage that skips crits and elements (damage over time, lightning arcs, thorns).
  rawDamage(p, m, amount, el) {
    if (!m || m.k !== 'm' || m.state === 'dead') return;
    const v = Math.max(1, Math.round(amount));
    m.hp -= v;
    this.events.push({ t: 'dmg', id: m.id, v, hp: Math.max(0, m.hp), el, dot: 1 });
    if (m.hp <= 0) { this.killMonster(m, p || [...this.players.values()][0]); return; }
    if (p) this.aggro(m, p);
  }

  updateDots() {
    const now = this.time;
    for (const m of [...this.ents.values()]) {
      if (m.k !== 'm' || m.state === 'dead') continue;
      if (m.burn) { if (m.burn.until <= now) m.burn = null; else this.rawDamage(this.players.get(m.burn.by), m, m.burn.dps * 0.5, 'fire'); }
      if (m.state === 'dead') continue;
      if (m.poison) { if (m.poison.until <= now) m.poison = null; else this.rawDamage(this.players.get(m.poison.by), m, m.poison.per * m.poison.stacks * 0.5, 'poison'); }
    }
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
    let dmg = Math.max(1, Math.round(amount * (1 - armorReduction(s.armor, lvl))));
    const ward = p.buffs.ward;
    if (ward && ward.hp > 0) {
      const soak = Math.min(ward.hp, dmg);
      ward.hp -= soak; dmg -= soak;
      if (ward.hp <= 0) { delete p.buffs.ward; this.events.push({ t: 'fx', k: 'ward', id: p.id, on: 0 }); }
      if (dmg <= 0) { this.events.push({ t: 'dmg', id: p.id, v: 0, w: 1 }); return; }
    }
    p.hp -= dmg;
    const D = this.duel;
    if (D?.state === 'fight' && (D.a === p.pid || D.b === p.pid) && p.hp <= 0) {
      p.hp = 1;
      this.events.push({ t: 'dmg', id: p.id, v: dmg, hp: 1 });
      this.endDuel(D.a === p.pid ? D.b : D.a, 'ko');
      return;
    }
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
      if (p.stats.thorns && !p.dead) this.rawDamage(p, m, p.stats.thorns, 'thorns');
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
      if (e.by) { this.updateShot(e, nx, ny); continue; }
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

  updateShot(e, nx, ny) {
    const p = this.players.get(e.by);
    let hitT = null;
    for (const t of this.targetsNear(nx, ny, 0.35)) { if (t.pid === e.by) continue; hitT = t; break; }
    const wall = !this.map.walkableAt(nx, ny);
    e.x = nx; e.y = ny;
    if (!hitT && !wall && e.life > 0) return;
    this.delEnt(e.id);
    if (!p || p.dead) return;
    if (e.aoe && (hitT || wall || e.life <= 0)) {
      this.events.push({ t: 'fx', k: 'flask', x: r1(nx), y: r1(ny), r: e.aoe });
      for (const t of this.targetsNear(nx, ny, e.aoe)) if (lineOfSight(this.map, nx, ny, t.x, t.y)) this.damageTarget(p, t, e.mult);
    } else if (hitT) {
      this.events.push({ t: 'fx', k: e.kind === 'thorn' ? 'thornhit' : 'spark', x: r1(nx), y: r1(ny) });
      this.damageTarget(p, hitT, e.mult);
    }
  }

  updateAreas() {
    if (!this.areas.length) return;
    const now = this.time;
    this.areas = this.areas.filter((a) => {
      if (now >= a.until) return false;
      if (now >= a.next) {
        a.next = now + a.every;
        const p = this.players.get(a.by);
        if (!p) return false;
        for (const t of this.targetsNear(a.x, a.y, a.r)) if (t.k === 'm') this.damageTarget(p, t, a.mult);
      }
      return true;
    });
  }


  // ------------------------------------------------------------ duels (town arena)
  startDuel(a, b, stake) {
    const A = this.map.arena;
    const pa = this.players.get(a); const pb = this.players.get(b);
    if (!A || !pa || !pb) return;
    this.duel = { a, b, stake, state: 'countdown', at: this.time + DUEL.countdown, ends: this.time + DUEL.countdown + DUEL.timeLimit };
    for (const [q, side] of [[pa, -1], [pb, 1]]) {
      q.x = A.x + side * A.r * 0.55; q.y = A.y; q.rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      q.dead = false; q.hp = q.stats.hpMax; q.mp = q.stats.mpMax; q.lastPosAt = this.time;
      this.party.emitTo(q.pid, 'correct', { x: q.x, y: q.y, force: true });
    }
    for (const e of [...this.ents.values()]) if (e.k === 'w' && (e.by === a || e.by === b)) this.delEnt(e.id);
    this.party.broadcast('duel', { state: 'countdown', a: pa.id, b: pb.id, an: pa.name, bn: pb.name, stake, secs: DUEL.countdown, x: A.x, y: A.y, r: A.r });
  }

  duelHit(p, e, mult) {
    const D = this.duel;
    if (!D || D.state !== 'fight' || e === p || e.dead) return;
    const pair = [D.a, D.b];
    if (!pair.includes(p.pid) || !pair.includes(e.pid)) return;
    const s = p.stats;
    let dmg = this.rng.int(s.dmg[0], s.dmg[1]) * mult * DUEL.pvpDamage;
    if (this.rng.chance(s.crit / 100)) dmg *= 1.75;
    if (s.lifeSteal && p.hp > 0) p.hp = Math.min(s.hpMax, p.hp + dmg * s.lifeSteal / 100);
    this.hurtPlayer(e, Math.max(1, Math.round(dmg)), { level: p.member.char.level });
  }

  updateDuel() {
    const D = this.duel; if (!D) return;
    const A = this.map.arena;
    if (D.state === 'countdown') {
      // Hold both fighters in place until the bell.
      if (this.time >= D.at) { D.state = 'fight'; this.party.broadcast('duel', { state: 'fight' }); }
      return;
    }
    if (this.time >= D.ends) { this.endDuel(null, 'time'); return; }
    for (const pid of [D.a, D.b]) {
      const q = this.players.get(pid);
      if (q && Math.hypot(q.x - A.x, q.y - A.y) > A.r + 1.2) { this.endDuel(pid === D.a ? D.b : D.a, 'ring'); return; }
    }
  }

  endDuel(winner, reason) {
    const D = this.duel; if (!D) return;
    this.duel = null;
    for (const pid of [D.a, D.b]) {
      const q = this.players.get(pid);
      if (q) { q.hp = q.stats.hpMax; q.mp = q.stats.mpMax; q.dead = false; }
    }
    const loser = winner ? (winner === D.a ? D.b : D.a) : null;
    const name = (pid) => this.players.get(pid)?.name || this.party.members.get(pid)?.char.name || 'Someone';
    settleDuel(this.party, D, winner);
    this.party.broadcast('duel', { state: 'end', winner: winner ? `p${winner}` : null, wn: winner ? name(winner) : null, ln: loser ? name(loser) : null, stake: D.stake, reason });
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
      if (p.buffs.bloodlust && p.buffs.bloodlust.until < now) { delete p.buffs.bloodlust; p.stats = p.member.derived(p.buffs); }
      if (p.buffs.ward && p.buffs.ward.until < now) { delete p.buffs.ward; this.events.push({ t: 'fx', k: 'ward', id: p.id, on: 0 }); }
      if (p.hot) { if (p.hot.until < now) p.hot = null; else p.hp = Math.min(p.stats.hpMax, p.hp + p.hot.perSec * dt); }
      // Town heals you quickly, except while you're fighting a duel.
      const dueling = this.duel && (this.duel.a === p.pid || this.duel.b === p.pid);
      const fast = this.spec.kind === 'town' && !dueling;
      p.hp = Math.min(p.stats.hpMax, p.hp + p.stats.hpRegen * dt * (fast ? 20 : 1));
      p.mp = Math.min(p.stats.mpMax, p.mp + p.stats.mpRegen * dt * (fast ? 10 : 1));
      // Auto-pickup gold and potions you walk over.
      for (const e of this.ents.values()) {
        if (e.k === 'l' && e.owner === p.pid && !e.item && Math.hypot(e.x - p.x, e.y - p.y) < 1.4) this.takeLoot(p, e);
      }
    }

    if (this.spec.kind === 'dungeon') {
      if (now >= this.fieldAt) { this.updateField(); this.fieldAt = now + 0.35; }
      for (const e of this.ents.values()) if (e.k === 'm') this.updateMonster(e, dt);
      this.separate(dt);
      if (this.tickN % 10 === 0) this.updateDots();
    }
    this.updateProjectiles(dt);
    this.updateAreas();
    this.updateDuel();
    if (this.timers.length) {
      const due = this.timers.filter((t) => t[0] <= now);
      if (due.length) { this.timers = this.timers.filter((t) => t[0] > now); for (const [, fn] of due) fn(); }
    }
    for (const e of [...this.ents.values()]) if (e.k === 'w') this.updateWolf(e, dt);

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
      if (e.k === 'w') { ms.push([e.id, r1(e.x), r1(e.y), r2(e.rot), 1, 1]); continue; }
      if (e.k !== 'm' || e.state === 'dead') continue;
      if (e.state === 'idle' && !players.some((p) => Math.hypot(p.x - e.x, p.y - e.y) < 50)) continue;
      const st = e.state === 'windup' || e.state === 'slam' ? 2 : e.stunUntil > this.time ? 3 : e.state === 'idle' ? 0 : 1;
      const fl = (e.burn ? 1 : 0) | (e.chillUntil > this.time ? 2 : 0) | (e.poison ? 4 : 0);
      ms.push([e.id, r1(e.x), r1(e.y), r2(e.rot), Math.max(0, Math.round(e.hp)), st, fl]);
    }
    const ev = this.events; this.events = [];
    this.party.broadcast('snap', { t: r2(this.time), p: ps, m: ms, ev });
  }
}
