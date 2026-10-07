// The running game: local hero movement (predicted), combat input, server snapshots and events.
import { buildMap, moveCircle, TILE, T, toTile } from '/shared/map.js';
import { SKILLS, CLASSES, xpToNext, MONSTERS, RARITY_COLOR, MATERIALS, SLOW_MULT } from '/shared/rules.js';
import { parseDebuffs } from './status.js';

const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const PLAYER_R = 0.45;
const now = () => performance.now() / 1000;
// Skills that stop you while their animation plays: [seconds, movement multiplier].
const ROOT = { cleave: [0.5, 0], bash: [0.4, 0], warcry: [0.55, 0], whirlwind: [0.8, 0.55] };

export class Game {
  constructor({ socket, world, input, ui, sfx, music, voice, me }) {
    Object.assign(this, { socket, world, input, ui, sfx, music, voice });
    this.pid = me.pid;
    this.char = me.char; this.derived = me.derived; this.next = me.next;
    this.myId = `p${me.pid}`;
    this.map = null; this.zone = null;
    this.me = null; // my entity view
    this.hp = 1; this.hpMax = 1; this.mp = 1; this.mpMax = 1; this.dead = false;
    this.cds = {}; this.nextAtk = 0; this.swingUntil = 0; this.dash = null;
    this.sendAt = 0; this.lastSent = null;
    this.explored = null; this.minimapAt = 0;
    this.roster = []; this.partyInfo = null;
    this.target = null; this.targetUntil = 0;
    this.active = true;
    this.handlers = [];
    this.bind();
    ui.setClassSkills(this.skillIds);
    ui.setChar(this.char, this.derived, this.next);
  }

  on(ev, fn) { this.socket.on(ev, fn); this.handlers.push([ev, fn]); }
  destroy() { this.world.labels.removeEventListener('mouseover', this.onOver); this.world.labels.removeEventListener('mouseout', this.onOut); this.ui.showLootCard(null); this.active = false; for (const [ev, fn] of this.handlers) this.socket.off(ev, fn); this.world.clearZone(); }

  bind() {
    const layer = this.world.labels;
    this.onOver = (e) => { const id = e.target.closest?.('.lbl')?.dataset.id; this.hoverLoot = id || null; };
    this.onOut = () => { this.hoverLoot = null; };
    layer.addEventListener('mouseover', this.onOver); layer.addEventListener('mouseout', this.onOut);
    this.on('zone', (z) => this.loadZone(z));
    this.on('snap', (s) => this.onSnap(s));
    this.on('add', (list) => list.forEach((e) => this.addEnt(e)));
    this.on('del', (ids) => ids.forEach((id) => this.world.remove(id)));
    this.on('correct', (c) => { if (this.me) { this.me.x = c.x; this.me.y = c.y; } });
    this.on('gold', (d) => { this.char.gold = d.gold; this.sfx.play('gold'); const v = this.me; if (v) this.world.fx.number(v.x, 1.6, v.y, `+${d.got}g`, 'xp'); this.ui.setChar(this.char, this.derived, this.next); });
    this.on('potions', (p) => { this.char.potions = p; this.ui.potions(p); this.sfx.play('pickup'); });
    this.on('inv', (d) => {
      this.char.inv = d.inv;
      if (d.got) { this.ui.lootMsg(d.got); this.sfx.play(d.got.rarity === 'rare' || d.got.rarity === 'legendary' ? 'rare' : 'pickup'); }
      this.ui.setChar(this.char, this.derived, this.next);
    });
    this.on('xp', (d) => { this.char.xp = d.xp; this.next = d.next; this.ui.xp(d.xp, d.next); });
    this.on('char', (d) => {
      this.char = d.char; this.derived = d.derived; this.next = d.next;
      this.ui.setChar(this.char, this.derived, this.next);
      this.remarkLoot();
    });
    this.on('levelup', (d) => {
      const v = this.world.ents.get(`p${d.pid}`);
      if (v) this.world.fx.pillar(v.x, v.y);
      if (d.pid === this.pid) { this.world.post.pulse(0xffd060, 0.45); this.sfx.play('levelup'); this.ui.center(`Level ${d.level}!`); this.ui.msg('New attribute and skill points — press I (or View) to spend them', 'good'); }
      else this.ui.msg(`${d.name} reached level ${d.level}`, 'good');
    });
    this.on('died', (d) => {
      this.dead = true;
      this.ui.death(true, `Lost ${d.lost} gold. Rising again in ${d.respawn}s…`);
      this.sfx.play('die');
      this.char.gold = d.gold;
    });
    this.on('msg', (m) => { this.ui.msg(m.text, m.kind); if (m.kind === 'warn') this.sfx.play('error'); });
    this.on('shop', (d) => { if (this.ui.shopData && !document.querySelector('#shop-panel').classList.contains('hidden')) this.ui.updateShopStock(d); else this.ui.openShop(d); });
    this.on('gate', (d) => this.ui.openGate(d.max));
    this.on('crafter', () => this.ui.openCraft());
    this.on('auction', () => this.ui.openAuction());
    this.on('bank', () => this.ui.openBank());
    this.on('mailbox', () => this.ui.openMail());
    this.on('mailNotice', (d) => {
      this.ui.setMailUnread(d.unread);
      if (d.join && d.unread > 0) this.ui.msg(`You have ${d.unread} unread letter${d.unread > 1 ? 's' : ''}. Visit the mailbox in town.`, 'good');
    });
    this.on('mats', (d) => {
      this.char.mats = d.mats;
      const def = MATERIALS[d.got.mat];
      if (def) { this.ui.msg(`+${d.got.n} ${def.name}`, def.boss ? 'good' : 'loot'); this.sfx.play(def.boss ? 'rare' : 'pickup'); }
      this.ui.setChar(this.char, this.derived, this.next);
    });
    this.on('salvaged', (d) => {
      const txt = Object.entries(d.got).map(([k, n]) => `+${n} ${MATERIALS[k]?.name}`).join(', ');
      this.ui.msg(`${d.count ? `Salvaged ${d.count} items: ` : 'Salvaged: '}${txt}`, 'good');
      this.sfx.play('break');
    });
    this.on('crafted', (d) => {
      this.sfx.play('levelup');
      this.ui.craftResult(`<div class="muted" style="font-size:12px;margin-bottom:4px">You crafted:</div>${this.ui.itemCard(d.item)}`);
    });
    this.on('travel', (d) => { this.ui.center(d.text, 1400); this.sfx.play('stairs'); document.querySelector('#fade').classList.add('on'); this.input.enabled = false; });
    this.on('status', (list) => {
      const t = now();
      this.status = list.map(([id, left, n]) => ({ id, until: t + left, n }));
      this.ui.setStatus(this.status, t);
    });
    this.on('buff', (b) => {
      const txt = { warcry: 'War Cry! Damage and armor up', bloodlust: 'Bloodlust! Faster attacks and life steal', ward: `Arcane Ward: absorbs ${b.hp} damage` }[b.id];
      if (txt) this.ui.msg(txt, 'good');
    });
    this.on('chat', (c) => this.ui.chatLine(c.name, c.text));
    this.on('party', (p) => {
      this.partyInfo = p; this.roster = p.members;
      this.ui.partyFrames(p.members, this.pid);
      this.ui.partyPanel(p, this.pid);
      if (!p.solo) this.voice.sync(p.members);
    });
    this.on('duelInvite', (d) => { this.ui.duelInvite(d); if (d) this.sfx.play('warcry'); });
    this.on('duel', (d) => this.onDuel(d));
    this.on('peerLeft', ({ pid }) => this.world.remove(`p${pid}`));
  }

  // ------------------------------------------------------------ zones
  loadZone(z) {
    this.zone = z;
    this.map = buildMap(z);
    this.world.loadZone(this.map);
    this.explored = new Uint8Array(this.map.w * this.map.h);
    this.me = null;
    for (const p of z.players) this.addPlayer(p);
    for (const e of z.ents) this.addEnt(e);
    for (const n of z.npcs || []) this.world.add({ id: `n_${n.id}`, k: 'n', type: n.type, name: n.name, x: n.x, y: n.y, rot: n.rot });
    this.bossAlive = z.bossAlive;
    const town = z.kind === 'town';
    this.ui.zoneName(town ? 'Emberfall Village' : `${{ crypt: 'The Crypts', cavern: 'Deep Caverns', infernal: 'The Burning Halls' }[z.theme]} · Floor ${z.floor}`);
    this.ui.center(town ? 'Emberfall Village' : `Floor ${z.floor}${z.floor % 5 === 0 ? ' — Guardian\'s Lair' : ''}`, 2000);
    this.sfx.ambience(town ? 'town' : 'dungeon');
    this.music?.play(town ? 'town' : z.theme);
    this.ui.boss(null); this.ui.death(false);
    this.dead = false;
    if (this.me) { this.world.focus.set(this.me.x, 0, this.me.y); }
    document.querySelector('#fade').classList.remove('on');
    this.input.enabled = true;
    this.ui.closePanels();
  }

  addPlayer(p) {
    const v = this.world.add(p, { me: p.pid === this.pid });
    if (!v) return;
    v.hp = p.hp; v.hpMax = p.hpMax; v.dead = p.dead;
    if (p.pid === this.pid) { this.me = v; v.local = true; this.hp = p.hp; this.hpMax = p.hpMax; }
  }

  markLoot(v) {
    if (!v.label || !v.e.item) return;
    v.label.innerHTML = `${this.ui.lootMark(v.e.item)}${v.e.item.name.replace(/[&<>]/g, '')}`;
  }
  remarkLoot() { for (const v of this.world.ents.values()) if (v.k === 'l') this.markLoot(v); }

  addEnt(e) {
    const v = this.world.add(e);
    if (v && e.k === 'm') { v.hp = e.hp; v.hpMax = e.hpMax; v.dead = e.dead; }
    if (v && e.k === 'l' && e.item && e.item.rarity !== 'common' && !e.dropped) this.sfx.play('drop');
    if (v && e.k === 'l' && e.item) this.markLoot(v);
    return v;
  }

  // ------------------------------------------------------------ server updates
  onSnap(s) {
    if (!this.map) return;
    if (this.duel) {
      const a = s.p.find((r) => r[0] === this.duel.a); const b = s.p.find((r) => r[0] === this.duel.b);
      if (a && b) this.ui.duelHp(a[4] / a[5], b[4] / b[5]);
    }
    for (const [id, x, y, rot, hp, hpMax, mp, mpMax, dead] of s.p) {
      const v = this.world.ents.get(id);
      if (!v) continue;
      v.hp = hp; v.hpMax = hpMax;
      if (id === this.myId) {
        this.hp = hp; this.hpMax = hpMax; this.mp = mp; this.mpMax = mpMax;
        if (this.dead && !dead) { this.dead = false; this.ui.death(false); v.anim?.revive(); }
      } else {
        v.tx = x; v.ty = y; v.trot = rot;
        if (dead && !v.dead) v.anim?.die();
        if (!dead && v.dead) v.anim?.revive();
        v.dead = !!dead;
        this.ui.partyHp(v.e.pid, hp, hpMax, dead);
      }
    }
    const tNow = now();
    for (const [id, x, y, rot, hp, st, fl, db] of s.m) {
      const v = this.world.ents.get(id);
      if (!v) continue;
      v.tx = x; v.ty = y; v.trot = rot; v.hp = hp; v.fl = fl || 0;
      v.db = db ? parseDebuffs(db, tNow) : null;
      if (v.anim && v.k === 'm') { const chill = !!(v.fl & 2); if (chill !== v.chilled) { v.chilled = chill; v.anim.tint = chill ? 0x5aa8ff : null; } }
      if (v.anim) { v.anim.windup = st === 2 && !MONSTERS[v.e.type]?.ranged; v.anim.stunned = st === 3; }
    }
    for (const ev of s.ev) this.onEvent(ev);
  }

  onEvent(ev) {
    const W = this.world;
    switch (ev.t) {
      case 'add': this.addEnt(ev.e); break;
      case 'del': W.remove(ev.id); break;
      case 'padd': if (!W.ents.has(ev.p.id)) this.addPlayer(ev.p); break;
      case 'pdel': W.remove(ev.id); break;
      case 'act': {
        const v = W.ents.get(ev.id);
        if (!v || ev.id === this.myId) break;
        if (v.k === 'p') {
          v.anim?.play(SKILLS[ev.a]?.anim || ev.a);
          if (ev.rot != null) { v.trot = ev.rot; v.rot = ev.rot; }
          this.skillFx(v, ev.a, ev.rot ?? v.rot, false);
        } else {
          v.anim?.play(ev.a === 'shoot' ? (v.e.type === 'imp' ? 'cast' : 'shoot') : ev.a);
          if (ev.a === 'shoot') this.sfx.play(v.e.type === 'imp' ? 'fireball' : 'arrow');
        }
        break;
      }
      case 'dash': {
        const v = W.ents.get(ev.id);
        if (v && ev.id !== this.myId) { v.x = ev.fx; v.y = ev.fy; v.tx = ev.x; v.ty = ev.y; }
        break;
      }
      case 'dmg': {
        const v = W.ents.get(ev.id);
        if (!v) break;
        const h = (v.obj.userData.height || 1.6) * (v.obj.scale.y || 1);
        if (v.k === 'p') {
          if (ev.b) { W.fx.number(v.x, h, v.y, 'Block', 'block'); this.sfx.play('block'); v.anim?.play('bash', 0.15); break; }
          if (ev.w) { W.fx.number(v.x, h, v.y, 'Absorbed', 'block'); this.sfx.play('block'); break; }
          if (ev.id === this.myId) { this.hp = ev.hp; W.fx.number(v.x, h, v.y, ev.v, 'me'); this.sfx.play('hurt'); W.shakeCam(0.18); this.input.rumble(90, 0.5, 0.3); W.post.pulse(0x8a0a06, Math.min(0.55, 0.18 + ev.v / Math.max(1, this.hpMax || 100))); }
          else if (this.duel?.live && (ev.id === this.duel.a || ev.id === this.duel.b)) { W.fx.number(v.x, h, v.y, ev.v, ''); this.sfx.play('hit'); }
          if (v.anim) v.anim.flinch = 0.15;
          W.fx.emit(v.x, 1.1, v.y, 8, { color: 0xb01010, speed: 2, size: 0.18, life: 0.4 });
        } else {
          v.hp = ev.hp;
          W.fx.number(v.x, h, v.y, ev.v, `${ev.c ? 'crit' : ''}${ev.el ? ` el-${ev.el}` : ''}${ev.dot ? ' dot' : ''}`);
          if (ev.dot) { if (v.bar) v.hp = ev.hp; break; }
          v.anim?.hit();
          const bony = v.e.type === 'skeleton' || v.e.type === 'archer';
          W.fx.emit(v.x, h * 0.6, v.y, ev.c ? 14 : 7, { color: bony ? 0xfff0d0 : v.e.type === 'imp' ? 0xff8030 : 0x9a1010, speed: 3, size: 0.2, life: 0.45 });
          this.sfx.play(ev.c ? 'crit' : bony ? 'bonk' : 'hit');
          if (ev.c) W.shakeCam(0.12);
          this.target = v; this.targetUntil = now() + 4;
        }
        break;
      }
      case 'die': {
        const v = W.ents.get(ev.id);
        if (!v) break;
        v.dead = true; v.hp = 0;
        v.anim?.die();
        if (v.bar) v.bar.visible = false;
        if (v.label) v.label.remove(), (v.label = null);
        const bony = v.e.type === 'skeleton' || v.e.type === 'archer';
        this.sfx.play(bony ? 'bones' : 'die');
        W.fx.emit(v.x, 0.8, v.y, 16, { color: bony ? 0xe8dcc0 : 0x6a0a0a, speed: 3, up: 3, size: 0.2, life: 0.7 });
        if (v.e.boss) { W.shakeCam(0.6); this.ui.center('Victory!', 2500); }
        setTimeout(() => W.remove(ev.id), 6000);
        break;
      }
      case 'pdie': { const v = W.ents.get(ev.id); if (v) { v.dead = true; v.anim?.die(); } break; }
      case 'prespawn': { const v = W.ents.get(ev.id); if (v) { v.dead = false; v.anim?.revive(); v.x = v.tx = ev.x; v.y = v.ty = ev.y; } break; }
      case 'break': {
        const v = W.ents.get(ev.id);
        if (v) { W.fx.emit(v.x, 0.5, v.y, 18, { color: 0x8a6a40, speed: 4, up: 4, size: 0.22, life: 0.8, gravity: 12 }); this.sfx.play('break'); W.remove(ev.id); }
        break;
      }
      case 'open': { const v = W.ents.get(ev.id); if (v) { v.opening = 0.01; v.e.open = true; this.sfx.play('chest'); W.fx.emit(v.x, 0.7, v.y, 25, { color: 0xffd060, speed: 1.5, up: 4, size: 0.2, life: 1, gravity: 2 }); } break; }
      case 'fx': this.zoneFx(ev); break;
      case 'tell': W.fx.telegraph(ev.x, ev.y, ev.r, ev.dur); this.sfx.play('tell'); break;
      case 'msg': this.ui.msg(ev.text, ev.kind); break;
      case 'boss': this.bossAlive = ev.alive; break;
      case 'look': {
        const v = W.ents.get(ev.id);
        if (!v) break;
        // Rebuild the model with new gear.
        const desc = { ...v.e, look: ev.look, level: ev.level, sync: ev.sync, x: v.x, y: v.y, rot: v.rot };
        const keep = { x: v.x, y: v.y, rot: v.rot, hp: v.hp, hpMax: ev.hpMax, local: v.local, dead: v.dead };
        W.remove(ev.id);
        const nv = W.add(desc, { me: ev.id === this.myId });
        Object.assign(nv, keep, { tx: keep.x, ty: keep.y, trot: keep.rot });
        if (ev.id === this.myId) { this.me = nv; this.hpMax = ev.hpMax; }
        break;
      }
      default: break;
    }
  }

  zoneFx(ev) {
    const W = this.world;
    if (ev.k === 'warcry') { W.fx.shockwave(ev.x, ev.y, ev.r, 0xffc040); }
    if (ev.k === 'slam') { W.fx.shockwave(ev.x, ev.y, ev.r * 1.1, 0xff6020); W.fx.emit(ev.x, 0.2, ev.y, 40, { color: 0x8a7a60, speed: 6, up: 3, size: 0.4, life: 0.8 }); W.shakeCam(0.7); this.sfx.play('slam'); this.input.rumble(300, 1, 0.6); }
    if (ev.k === 'summon') { W.fx.ring(ev.x, ev.y, 3, 0x8a3aff); }
    if (ev.k === 'burst') W.fx.emit(ev.x, 1.1, ev.y, 18, { color: 0xff7020, speed: 3, size: 0.35, life: 0.45 });
    if (ev.k === 'spark') W.fx.emit(ev.x, 1.1, ev.y, 6, { color: 0xffe0a0, speed: 2, size: 0.12, life: 0.3 });
    if (ev.k === 'leap') { W.fx.shockwave(ev.x, ev.y, ev.r, 0xff8040); W.fx.emit(ev.x, 0.2, ev.y, 30, { color: 0x9a8a70, speed: 5, up: 3, size: 0.35, life: 0.7 }); W.shakeCam(0.35); this.sfx.play('slam'); }
    if (ev.k === 'flask') { W.fx.shockwave(ev.x, ev.y, ev.r, 0xff6a20); W.fx.emit(ev.x, 0.6, ev.y, 28, { color: 0xff7020, speed: 4, up: 3, size: 0.4, life: 0.55 }); this.sfx.play('fireball'); }
    if (ev.k === 'nova') { W.fx.shockwave(ev.x, ev.y, ev.r, 0x80d8ff); W.fx.ring(ev.x, ev.y, ev.r * 0.9, 0xc0f0ff, 60, 0.4); W.fx.emit(ev.x, 0.5, ev.y, 30, { color: 0xd0f4ff, speed: 6, up: 1.5, size: 0.3, life: 0.6, gravity: 2 }); this.sfx.play('block'); }
    if (ev.k === 'acid') { W.fx.pool(ev.x, ev.y, ev.r, 0x5aff3a, ev.dur); W.fx.emit(ev.x, 0.4, ev.y, 20, { color: 0x8aff5a, speed: 2.5, up: 2, size: 0.3, life: 0.6 }); this.sfx.play('potion'); this.acidFx(ev); }
    if (ev.k === 'roots') { W.fx.roots(ev.x, ev.y, ev.r, ev.dur); this.sfx.play('break'); }
    if (ev.k === 'rejuv') { W.fx.pool(ev.x, ev.y, ev.r, 0x5aff8a, 0.9, { opacity: 0.25, pulse: false }); W.fx.ring(ev.x, ev.y, ev.r * 0.8, 0x8aff9a, 50, 0.4); this.sfx.play('potion'); }
    if (ev.k === 'zap') { W.fx.zap(ev.x, ev.y, ev.x2, ev.y2); this.sfx.play('crit'); }
    if (ev.k === 'thornhit') W.fx.emit(ev.x, 1.0, ev.y, 6, { color: 0x8ac04a, speed: 2, size: 0.14, life: 0.3 });
    if (ev.k === 'bloodlust') { const v = W.ents.get(ev.id); if (v) { W.fx.emit(v.x, 1, v.y, 30, { color: 0xff2020, speed: 2, up: 3, size: 0.3, life: 0.8, gravity: -1 }); W.fx.shockwave(v.x, v.y, 2.5, 0xff3030); } }
    if (ev.k === 'ward') {
      const v = W.ents.get(ev.id);
      if (v && ev.on && !v.bubble) { v.bubble = W.fx.bubble(v.obj); clearTimeout(v.bubbleT); v.bubbleT = setTimeout(() => { v.bubble?.removeFromParent(); v.bubble = null; }, 12500); }
      if (v && !ev.on && v.bubble) { v.bubble.removeFromParent(); v.bubble = null; }
    }
    if (ev.k === 'heal' || ev.k === 'mana') {
      const v = W.ents.get(ev.id);
      if (v) W.fx.emit(v.x, 0.4, v.y, 24, { color: ev.k === 'heal' ? 0xff4050 : 0x4a7aff, speed: 0.8, up: 3, size: 0.25, life: 0.9, gravity: -1 });
    }
  }

  // Bubbles rising from an acid pool for as long as it lasts.
  acidFx(ev) {
    const W = this.world; const end = now() + ev.dur;
    const tick = () => { if (now() > end || !this.active) return; for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; const d = Math.sqrt(Math.random()) * ev.r; W.fx.emit(ev.x + Math.cos(a) * d, 0.1, ev.y + Math.sin(a) * d, 1, { color: 0x7aff4a, speed: 0.2, up: 1.5, size: 0.25, life: 0.7, gravity: -0.5 }); } setTimeout(tick, 90); };
    tick();
  }

  skillFx(v, a, rot, mine) {
    const W = this.world;
    const fx = Math.sin(rot); const fy = Math.cos(rot);
    if (a === 'throw') { if (mine) this.sfx.play('swing'); }
    if (a === 'frenzy') { W.fx.swing(v.x, v.y, rot, { radius: 2.4, arc: 2.2, color: 0xff9060, dur: 0.2 }); setTimeout(() => W.fx.swing(v.x, v.y, rot, { dir: -1, radius: 2.4, arc: 2.2, color: 0xff6040, dur: 0.2 }), 160); this.sfx.play('swing'); setTimeout(() => this.sfx.play('swing'), 160); }
    if (a === 'leap') this.sfx.play('charge');
    if (a === 'whirlwind') { for (let i = 0; i < 4; i++) setTimeout(() => { const t = this.world.ents.get(v.id) || v; W.fx.swing(t.x, t.y, rot + i * 1.6, { radius: 3, arc: 4.2, color: 0xffc080, dur: 0.25 }); this.sfx.play('swing'); }, i * 200); }
    if (a === 'bloodlust') this.sfx.play('warcry');
    if (a === 'flask' || a === 'thorns') this.sfx.play('swing');
    if (a === 'nova' || a === 'acid' || a === 'entangle') W.fx.emit(v.x + fx * 0.6, 1.4, v.y + fy * 0.6, 10, { color: a === 'nova' ? 0xc0f0ff : a === 'acid' ? 0x8aff5a : 0x8ac04a, speed: 1.5, size: 0.2, life: 0.4 });
    if (a === 'ward') { this.sfx.play('levelup'); W.fx.ring(v.x, v.y, 3, 0xa080ff, 40, 1.0); }
    if (a === 'wolf') { this.sfx.play('warcry'); }
    if (a === 'rejuv') W.fx.emit(v.x, 1.6, v.y, 16, { color: 0x8aff9a, speed: 1.5, up: 2, size: 0.25, life: 0.6, gravity: -1 });
    if (a === 'swing') { W.fx.swing(v.x, v.y, rot, { dir: (v.anim?.combo || 0) === 1 ? -1 : 1, radius: 2.0, arc: 2.0 }); if (mine) this.sfx.play('swing'); }
    if (a === 'cleave') { W.fx.swing(v.x, v.y, rot, { radius: 2.9, arc: 3.5, color: 0xffd080, dur: 0.35 }); this.sfx.play('cleave'); }
    if (a === 'bash') { W.fx.emit(v.x + Math.sin(rot) * 1.2, 1, v.y + Math.cos(rot) * 1.2, 14, { color: 0xffe0a0, speed: 3, size: 0.2, life: 0.35 }); this.sfx.play('bash'); if (mine) W.shakeCam(0.2); }
    if (a === 'charge') this.sfx.play('charge');
    if (a === 'warcry') this.sfx.play('warcry');
  }

  // ------------------------------------------------------------ input actions
  action(name, down, src) {
    if (!down || !this.active) return;
    const ui = this.ui;
    if (name === 'menu') { if (ui.anyOpen()) ui.closePanels(); else ui.toggle('menu'); return; }
    if (name === 'inventory' || name === 'character') { ui.toggle('char'); return; }
    if (name === 'skills') { ui.open('char', 'skills'); return; }
    if (name === 'map') { document.querySelector('#minimap').classList.toggle('big'); return; }
    if (name === 'chat') { ui.openChat(); return; }
    if (name === 'ptt') { this.voice.pushToTalk(true); return; }
    if (ui.anyOpen()) {
      // Controller drives the open panel.
      if (src === 'pad') {
        if (name === 'padUp') ui.padNav('up'); else if (name === 'padDown') ui.padNav('down');
        else if (name === 'padLeft') ui.padNav('left'); else if (name === 'padRight') ui.padNav('right');
        else if (name === 'attack') ui.padPress(); // A
        else if (name === 'skill0') ui.padPrimary(); // X
        else if (name === 'skill1') ui.padSecondary(); // Y
        else if (name === 'skill2') ui.closePanels(); // B
        else if (name === 'use') ui.padTab(-1); // LB
        else if (name === 'skill3') ui.padTab(1); // RB
      }
      return;
    }
    // D-pad up/down zooms the camera during play.
    if (name === 'padUp' || name === 'padDown') { this.world.targetDist = Math.max(9, Math.min(24, this.world.targetDist + (name === 'padUp' ? -1.5 : 1.5))); return; }
    if (name === 'padLeft' || name === 'padRight') return;
    if (this.dead) return;
    if (name === 'hp' || name === 'mp') { this.potion(name); return; }
    if (name === 'use') { this.interact(); return; }
    if (name.startsWith('skill')) { this.useSkill(Number(name.slice(5))); return; }
    if (name === 'attack') this.tryAttack();
  }

  potion(kind) {
    if (!this.char.potions[kind]) { this.ui.msg(`No ${kind === 'hp' ? 'health' : 'mana'} potions`, 'warn'); this.sfx.play('error'); return; }
    this.socket.emit('potion', { kind });
    this.sfx.play('potion');
  }

  // ------------------------------------------------------------ duels
  onDuel(d) {
    const W = this.world;
    if (d.state === 'countdown') {
      this.duel = { ...d, live: false };
      this.ui.duelBar(d);
      if (d.a === this.myId || d.b === this.myId) {
        this.dash = null; this.ui.closePanels();
        let n = d.secs; const tick = () => { if (!this.duel || this.duel.live) return; this.ui.center(String(n), 900); this.sfx.play('click'); n--; if (n > 0) setTimeout(tick, 1000); };
        tick();
      } else this.ui.msg(`${d.an} and ${d.bn} are dueling in the arena${d.stake ? ` for ${(d.stake * 2).toLocaleString()} gold` : ''}!`, 'info');
      W.fx.pool(d.x, d.y, d.r, 0xffa040, d.secs + 0.5, { opacity: 0.12 });
    }
    if (d.state === 'fight' && this.duel) {
      this.duel.live = true;
      if (this.inDuel) { this.ui.center('Fight!', 1200); this.sfx.play('warcry'); }
    }
    if (d.state === 'end') {
      const mine = this.duel && (this.duel.a === this.myId || this.duel.b === this.myId);
      this.duel = null; this.ui.duelBar(null);
      const why = { ring: ' (left the ring)', left: ' (opponent left)', time: '' }[d.reason] || '';
      if (!d.winner) this.ui.center('Draw — stakes returned', 2500);
      else if (d.winner === this.myId) { this.ui.center(`Victory!${d.stake ? ` +${(d.stake * 2).toLocaleString()} gold` : ''}`, 3000); this.sfx.play('levelup'); }
      else if (mine) { this.ui.center(`${d.wn} wins the duel${why}`, 3000); this.sfx.play('error'); }
      else this.ui.msg(`${d.wn} defeated ${d.ln} in a duel${d.stake ? ` and won ${(d.stake * 2).toLocaleString()} gold` : ''}${why}`, 'info');
    }
  }
  get inDuel() { return !!this.duel?.live && (this.duel.a === this.myId || this.duel.b === this.myId); }
  get duelFoe() { if (!this.inDuel) return null; return this.world.ents.get(this.duel.a === this.myId ? this.duel.b : this.duel.a); }

  get skillIds() { return CLASSES[this.char?.cls]?.skills || CLASSES.knight.skills; }
  get ranged() { return !!CLASSES[this.char?.cls]?.ranged; }

  aimRot() {
    const me = this.me;
    // The mouse only drives menus and the camera, so attacks never aim at the cursor (it's
    // often resting behind the hero, which spun them around). Aim assist: nearest monster in
    // front, then nearest anywhere close; otherwise keep facing the way you're going.
    let best = null; let bs = 1e9;
    const face = me.rot;
    for (const v of this.world.ents.values()) {
      if (((v.k !== 'm' && v.k !== 'b') && v !== this.duelFoe) || v.dead) continue;
      const d = Math.hypot(v.x - me.x, v.y - me.y);
      if (d > (this.ranged ? 12 : 5.5)) continue;
      let da = Math.atan2(v.x - me.x, v.y - me.y) - face; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const s = d + Math.abs(da) * 2.2 + (v.k === 'b' ? 3 : 0);
      if (s < bs) { bs = s; best = v; }
    }
    return best ? Math.atan2(best.x - me.x, best.y - me.y) : face;
  }

  tryAttack() {
    const t = now();
    if (!this.me || this.dead || t < this.nextAtk || this.dash) return;
    const rot = this.aimRot();
    this.me.rot = rot;
    this.nextAtk = t + this.derived.atkInterval;
    this.swingUntil = t + this.derived.atkInterval * 0.6;
    if (this.ranged) { this.me.anim.play('throw'); this.skillFx(this.me, 'throw', rot, true); } else { this.me.anim.play('swing'); this.skillFx(this.me, 'swing', rot, true); }
    this.socket.emit('atk', { rot });
    this.sendPos(true);
  }

  useSkill(i) {
    const id = this.skillIds[i]; const sk = SKILLS[id];
    if (!sk) return;
    const rank = this.char.skills[id] || 0;
    const t = now();
    if (!this.me || this.dash) return;
    if (rank < 1) { this.ui.msg(this.char.level < sk.unlock ? `${sk.name} unlocks at level ${sk.unlock}` : `Spend a skill point on ${sk.name} first`, 'warn'); this.sfx.play('error'); return; }
    if ((this.cds[id] || 0) > t) return;
    if (this.mp < sk.mana(rank)) { this.ui.msg('Not enough mana', 'warn'); this.sfx.play('error'); return; }
    if (sk.needsShield && !this.char.equip.offhand) { this.ui.msg(`${sk.name} needs a shield`, 'warn'); this.sfx.play('error'); return; }
    const rot = this.aimRot();
    this.me.rot = rot;
    this.cds[id] = t + sk.cd;
    this.mp -= sk.mana(rank);
    this.nextAtk = t + 0.35; this.swingUntil = t + 0.3;
    this.sendPos(true);
    this.socket.emit('skill', { id, rot });
    this.me.anim.play(sk.anim || id);
    // Whole-body moves hold you in place while they play (Whirlwind lets you drift).
    const R = ROOT[id]; if (R) this.root = { until: t + R[0], mul: R[1] };
    this.skillFx(this.me, id, rot, true);
    if (id === 'leap') {
      const dist = sk.dist(rank);
      const to = moveCircle(this.map, this.me.x, this.me.y, Math.sin(rot) * dist, Math.cos(rot) * dist, PLAYER_R);
      this.dash = { fx: this.me.x, fy: this.me.y, x: to.x, y: to.y, t: 0, dur: 0.36, leap: true };
    }
    if (id === 'charge') {
      const dist = sk.dist(rank);
      const to = moveCircle(this.map, this.me.x, this.me.y, Math.sin(rot) * dist, Math.cos(rot) * dist, PLAYER_R);
      this.dash = { fx: this.me.x, fy: this.me.y, x: to.x, y: to.y, t: 0, dur: 0.24 };
    }
    if (id === 'warcry') this.world.fx.shockwave(this.me.x, this.me.y, sk.radius, 0xffc040);
  }

  // Nearest thing you can use: item on the ground, chest, stairs, NPC, gate.
  findUsable() {
    const me = this.me; if (!me || !this.map) return null;
    let best = null; let bd = 1e9;
    const consider = (d, max, o) => { if (d <= max && d < bd) { bd = d; best = o; } };
    for (const v of this.world.ents.values()) {
      const d = Math.hypot(v.x - me.x, v.y - me.y);
      if (v.k === 'l' && v.e.item) consider(d, 2.4, { kind: 'loot', id: v.id, text: `Pick up ${v.e.item.name}`, color: RARITY_COLOR[v.e.item.rarity] });
      if (v.k === 'c' && !v.e.open) consider(d, 2.6, { kind: 'chest', id: v.id, text: 'Open chest' });
      if (v.k === 'n') consider(d, 3.5, { kind: 'npc', text: v.e.type === 'mailbox' ? 'Check the mailbox' : v.e.type === 'banker' ? `Visit your bank (${v.e.name})` : `Talk to ${v.e.name}` });
    }
    const m = this.map;
    if (m.kind === 'dungeon') {
      consider(Math.hypot(m.exit.x - me.x, m.exit.y - me.y), 2.4, { kind: 'down', text: this.bossAlive ? 'The stairs are sealed' : `Descend to floor ${m.floor + 1}` });
      consider(Math.hypot(m.entry.x - me.x, m.entry.y - me.y), 2.4, { kind: 'up', text: 'Return to town' });
    } else {
      consider(Math.hypot(m.exit.x - me.x, m.exit.y - me.y), 3.8, { kind: 'gate', text: 'Enter the dungeon' });
      // Duel arena: standing in the ring offers a challenge to the nearest party member.
      const A = m.arena;
      if (A && !this.duel && Math.hypot(me.x - A.x, me.y - A.y) < A.r + 0.5) {
        if (this.partyInfo?.solo !== false) consider(60, 99, { kind: 'hint', text: 'Duel arena: host a party and bring a friend here to duel' });
        else {
          let foe = null; let fd = 1e9;
          for (const v of this.world.ents.values()) {
            if (v.k !== 'p' || v.id === this.myId || v.e.dead) continue;
            const d = Math.hypot(v.x - me.x, v.y - me.y);
            if (d < fd) { fd = d; foe = v; }
          }
          if (foe && fd < 30) consider(Math.max(3, fd), 99, { kind: 'duel', pid: foe.e.pid, name: foe.e.name, text: `Challenge ${foe.e.name} to a duel` });
          else consider(60, 99, { kind: 'hint', text: 'Duel arena: a party member can meet you here to duel' });
        }
      }
    }
    return best;
  }

  interact() {
    const u = this.findUsable();
    if (!u) return;
    if (u.kind === 'loot') this.socket.emit('pickup', { id: u.id });
    else if (u.kind === 'duel') this.ui.openDuelSetup({ pid: u.pid, name: u.name });
    else if (u.kind === 'hint') this.ui.msg(u.text, 'info');
    else this.socket.emit('interact', { id: u.id });
  }

  pickup(id) {
    const v = this.world.ents.get(id);
    if (!v || !this.me) return;
    if (Math.hypot(v.x - this.me.x, v.y - this.me.y) > 3) { this.ui.msg('Too far away', 'warn'); return; }
    this.socket.emit('pickup', { id });
  }

  nearShop() {
    if (!this.map || this.map.kind !== 'town' || !this.me) return false;
    return this.map.npcs.some((n) => Math.hypot(n.x - this.me.x, n.y - this.me.y) < 5);
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    if (!this.me || !this.map) return;
    const me = this.me; const t = now();
    const W = this.world;
    // camera keys
    if (!this.input.typing()) {
      if (this.input.keys.has('z')) W.yaw += dt * 2;
      if (this.input.keys.has('x')) W.yaw -= dt * 2;
    }
    if (this.dash) {
      const d = this.dash; d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      me.x = d.fx + (d.x - d.fx) * k; me.y = d.fy + (d.y - d.fy) * k; me.speed = d.leap ? 0 : 12;
      if (!d.leap) W.fx.emit(me.x, 0.3, me.y, 2, { color: 0xd0c0a0, speed: 0.5, up: 1, size: 0.3, life: 0.4, gravity: 0 });
      if (k >= 1) { this.dash = null; this.sendPos(true); }
    } else if (!this.dead) {
      const frozen = this.duel && !this.duel.live && (this.duel.a === this.myId || this.duel.b === this.myId);
      const mv = frozen ? { x: 0, y: 0 } : this.input.moveVector();
      const ui = this.ui.anyOpen();
      let mx = 0; let my = 0;
      if (!ui && (mv.x || mv.y)) {
        // camera-relative → world
        const fx = -Math.sin(W.yaw); const fz = -Math.cos(W.yaw);
        const rx = Math.cos(W.yaw); const rz = -Math.sin(W.yaw);
        mx = fx * mv.y + rx * mv.x; my = fz * mv.y + rz * mv.x;
      }
      const mag = Math.hypot(mx, my);
      const slowed = this.status?.some((x) => x.id === 'slow' && x.until > t);
      const rooted = this.root && t < this.root.until ? this.root.mul : 1;
      const slow = Math.min(t < this.swingUntil ? 0.3 : 1, rooted) * (slowed ? SLOW_MULT : 1);
      const speed = this.derived.moveSpeed * Math.min(1, mag) * slow;
      if (mag > 0.05) {
        const np = moveCircle(this.map, me.x, me.y, (mx / mag) * speed * dt, (my / mag) * speed * dt, PLAYER_R);
        const moved = Math.hypot(np.x - me.x, np.y - me.y);
        me.x = np.x; me.y = np.y;
        me.speed = moved / dt;
        if (t >= this.swingUntil) {
          const want = Math.atan2(mx, my);
          let dr = want - me.rot; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
          me.rot += dr * Math.min(1, dt * 16);
        }
      } else me.speed = 0;
      if (!ui && this.input.attacking()) this.tryAttack();
      // face the mouse while idle so aiming feels direct
      if (this.input.source === 'keyboard' && this.input.mouse.inside && mag < 0.05 && t >= this.swingUntil) {
        const hov = W.pick(this.input.mouse.x, this.input.mouse.y);
        if (hov) { this.target = hov; this.targetUntil = t + 2; }
      }
    } else me.speed = 0;
    // local mana regen prediction (server corrects in snapshots)
    this.mp = Math.min(this.mpMax, this.mp + (this.derived.mpRegen || 1) * dt);
    this.sendPos(false);

    // HUD
    this.ui.vitals(this.hp, this.hpMax, this.mp, this.mpMax);
    this.ui.skills(this.cds, t, this.mp);
    this.ui.statusTick(t);
    const usable = this.ui.anyOpen() ? null : this.findUsable();
    this.ui.prompt(usable?.text || null);
    // Item card for loot under the mouse, or the item you're standing next to. Not on touch
    // screens: there the card would cover the fight; details show in the pack after pickup.
    let lootV = null;
    if (!this.ui.anyOpen() && !(COARSE && this.ui.source !== 'pad')) {
      if (this.hoverLoot && W.ents.has(this.hoverLoot)) lootV = W.ents.get(this.hoverLoot);
      else if (usable?.kind === 'loot') lootV = W.ents.get(usable.id);
    }
    if (lootV?.e.item && lootV.label && lootV.label.style.display !== 'none') this.ui.showLootCard(lootV.e.item, lootV.label.getBoundingClientRect());
    else this.ui.showLootCard(null);
    if (this.target && (t > this.targetUntil || this.target.dead || !W.ents.has(this.target.id))) this.target = null;
    this.ui.target(this.target);
    let boss = null;
    for (const v of W.ents.values()) if (v.k === 'm' && v.e.boss && !v.dead && Math.hypot(v.x - me.x, v.y - me.y) < 26) boss = v;
    this.ui.boss(boss);
    this.music?.setBoss(!!boss);
    if (t > this.minimapAt) { this.minimapAt = t + 0.15; this.drawMinimap(); }
  }

  sendPos(force) {
    const t = now();
    if (!this.me || this.dash) return;
    if (!force && t < this.sendAt) return;
    const me = this.me;
    const l = this.lastSent;
    if (!force && l && Math.abs(l.x - me.x) < 0.01 && Math.abs(l.y - me.y) < 0.01 && Math.abs(l.rot - me.rot) < 0.05) return;
    this.sendAt = t + 1 / 15;
    this.lastSent = { x: me.x, y: me.y, rot: me.rot };
    this.socket.emit('pos', { x: +me.x.toFixed(2), y: +me.y.toFixed(2), rot: +me.rot.toFixed(2) });
  }

  drawMinimap() {
    const c = document.querySelector('#minimap');
    const big = c.classList.contains('big');
    const size = big ? 640 : 180;
    if (c.width !== size) { c.width = size; c.height = size; }
    const g = c.getContext('2d');
    const m = this.map; const me = this.me;
    const mtx = toTile(me.x); const mty = toTile(me.y);
    const R = this.map.kind === 'town' ? 40 : 9;
    for (let y = mty - R; y <= mty + R; y++) for (let x = mtx - R; x <= mtx + R; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      if ((x - mtx) ** 2 + (y - mty) ** 2 <= R * R) this.explored[y * m.w + x] = 1;
    }
    g.clearRect(0, 0, size, size);
    g.save();
    const scale = big ? Math.min(size / (m.w + 4), size / (m.h + 4)) : 4;
    g.translate(size / 2, size / 2);
    if (!big) g.rotate(this.world.yaw);
    g.scale(scale, scale);
    if (big) g.translate(-m.w / 2, -m.h / 2); else g.translate(-me.x / TILE, -me.y / TILE);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!this.explored[y * m.w + x]) continue;
      const v = m.tiles[y * m.w + x];
      if (v === T.FLOOR) g.fillStyle = m.kind === 'town' ? (m.ground[y * m.w + x] ? 'rgba(200,190,170,.55)' : 'rgba(90,140,70,.45)') : 'rgba(170,150,120,.5)';
      else if (v === T.WALL) g.fillStyle = 'rgba(70,55,40,.9)';
      else if (v === T.PILLAR || v === T.BLOCK) g.fillStyle = 'rgba(110,90,70,.85)';
      else continue;
      g.fillRect(x, y, 1.02, 1.02);
    }
    const dot = (wx, wy, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(wx / TILE, wy / TILE, r, 0, Math.PI * 2); g.fill(); };
    const seen = (wx, wy) => this.explored[toTile(wy) * m.w + toTile(wx)];
    if (m.exit && seen(m.exit.x, m.exit.y)) dot(m.exit.x, m.exit.y, '#6aa0ff', 1.3);
    if (m.entry && m.kind === 'dungeon' && seen(m.entry.x, m.entry.y)) dot(m.entry.x, m.entry.y, '#ffd890', 1.1);
    for (const n of m.npcs) dot(n.x, n.y, '#9fe0ff', 0.9);
    for (const v of this.world.ents.values()) {
      if (v.k === 'm' && !v.dead && Math.hypot(v.x - me.x, v.y - me.y) < 18) dot(v.x, v.y, v.e.boss ? '#ff4040' : '#d03030', v.e.boss ? 1.2 : 0.55);
      if (v.k === 'p' && v !== me) dot(v.x, v.y, '#5fe07a', 0.8);
      if (v.k === 'l' && v.e.item && v.e.item.rarity !== 'common') dot(v.x, v.y, RARITY_COLOR[v.e.item.rarity], 0.5);
      if (v.k === 'c' && !v.e.open && seen(v.x, v.y)) dot(v.x, v.y, '#ffd060', 0.7);
    }
    // me (arrow)
    g.translate(me.x / TILE, me.y / TILE);
    g.rotate(-me.rot + Math.PI);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -1.4); g.lineTo(0.9, 1); g.lineTo(-0.9, 1); g.closePath(); g.fill();
    g.restore();
  }
}
