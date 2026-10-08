import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Server } from 'socket.io';
import { openDb, MAX_CHARS } from './db.js';
import { auctionAction, setOnlineLookup } from './auction.js';
import { makeItem } from '../shared/rules.js';
import { RNG } from '../shared/rng.js';
import { duelAction } from './duel.js';
import { bankAction } from './bank.js';
import { mailAction, mailOnJoin, setMailOnlineLookup } from './mail.js';
import { adminHandler } from './admin.js';
import { loadSecret, hashPassword, checkPassword, signToken, verifyToken, validUsername, validPassword, verifyGoogleToken, rateLimited } from './auth.js';
import { Party, Member, parties, listGroups, onlineCount } from './party.js';
import { newCharacter, validName, CLASSES, xpToNext, derive, GAME_TITLE } from '../shared/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export async function startServer({ port = Number(process.env.PORT) || 3000, dataDir = process.env.DATA_DIR || path.join(root, 'data') } = {}) {
  const db = await openDb({ dataDir });
  const findOnline = (charId) => { for (const p of parties.values()) for (const m of p.members.values()) if (m.charId === charId) return m; return null; };
  setOnlineLookup(findOnline); setMailOnlineLookup(findOnline);
  const secret = loadSecret(dataDir);
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const THREE_DIR = [path.join(root, 'node_modules/three'), process.resourcesPath && path.join(process.resourcesPath, 'three')]
    .find((d) => d && existsSync(path.join(d, 'build/three.module.js'))) || path.join(root, 'node_modules/three');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/vendor/three', express.static(THREE_DIR, { maxAge: '7d' }));
  app.use('/vendor/fontsource', express.static(path.join(root, 'node_modules/@fontsource'), { maxAge: '30d' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true, parties: parties.size }));
  app.get('/api/config', (_req, res) => res.json({ title: GAME_TITLE, googleClientId: googleClientId || null }));

  app.get('/api/ice', (_req, res) => {
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) {
      iceServers.push({ urls: process.env.TURN_URL.split(',').map((s) => s.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
    }
    res.json({ iceServers });
  });

  const fail = (res, code, error) => res.status(code).json({ ok: false, error });
  const session = (acct) => ({ ok: true, token: signToken(secret, acct.id), username: acct.username || acct.email || 'Adventurer' });

  app.post('/api/register', async (req, res) => {
    if (rateLimited(req.ip, 8)) return fail(res, 429, 'Too many attempts, wait a minute');
    const { username, password } = req.body || {};
    if (!validUsername(username)) return fail(res, 400, 'Usernames are 3–20 letters, numbers or _');
    if (!validPassword(password)) return fail(res, 400, 'Passwords need at least 6 characters');
    if (await db.findAccountByUsername(username)) return fail(res, 409, 'That username is taken');
    const acct = await db.createAccount({ username, pass: await hashPassword(password) });
    res.json(session(acct));
  });

  app.post('/api/login', async (req, res) => {
    if (rateLimited(req.ip)) return fail(res, 429, 'Too many attempts, wait a minute');
    const { username, password } = req.body || {};
    const acct = typeof username === 'string' ? await db.findAccountByUsername(username) : null;
    if (!acct || !acct.pass || !(await checkPassword(String(password || ''), acct.pass))) return fail(res, 401, 'Wrong username or password');
    if (acct.banned) return fail(res, 403, 'This account has been banned');
    res.json(session(acct));
  });

  app.post('/api/google', async (req, res) => {
    if (rateLimited(req.ip)) return fail(res, 429, 'Too many attempts, wait a minute');
    try {
      const g = await verifyGoogleToken(String(req.body?.credential || ''), googleClientId);
      let acct = await db.findAccountByGoogle(g.sub);
      // Signed in already with a password account? Link Google to it.
      const linkTo = verifyToken(secret, req.body?.linkToken);
      if (!acct && linkTo) { await db.linkGoogle(linkTo, g.sub, g.email); acct = await db.getAccount(linkTo); }
      if (!acct) acct = await db.createAccount({ username: null, googleSub: g.sub, email: g.email });
      if (acct.banned) return fail(res, 403, 'This account has been banned');
      res.json(session(acct));
    } catch (e) { fail(res, 401, e.message); }
  });

  const server = createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 2e5, pingInterval: 10000, pingTimeout: 20000 });
  const online = new Map(); // `${accountId}:${charId}` -> socket (one session per character)
  let pidSeq = 1;

  io.use(async (socket, next) => {
    const id = verifyToken(secret, socket.handshake.auth?.token);
    if (!id) return next(new Error('auth'));
    try { if ((await db.getAccount(id))?.banned) return next(new Error('banned')); } catch { /* db hiccup: let them in */ }
    socket.data.accountId = id;
    next();
  });

  io.on('connection', (socket) => {
    const aid = socket.data.accountId;
    let member = null;
    const reply = (cb, err, extra = {}) => typeof cb === 'function' && cb(err ? { ok: false, error: err } : { ok: true, ...extra });
    const inParty = (fn) => (d, cb) => {
      if (typeof d === 'function') { cb = d; d = {}; }
      if (!member?.party) return reply(cb, 'Not in a game');
      try { const err = fn(d || {}); reply(cb, err || null); } catch (e) { console.error(e); reply(cb, 'Server error'); }
    };

    socket.on('chars', async (cb) => {
      try {
        const acct = await db.getAccount(aid);
        if (!acct) return reply(cb, 'Account not found');
        reply(cb, null, { chars: await db.listCharacters(aid), username: acct.username || acct.email || 'Adventurer', classes: Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, { name: c.name, blurb: c.blurb, icon: c.icon, starter: c.starter }])), max: MAX_CHARS });
      } catch (e) { console.error(e); reply(cb, 'Server error'); }
    });

    socket.on('createChar', async (d = {}, cb) => {
      try {
        const name = String(d.name || '').trim().replace(/\s+/g, ' ');
        if (!validName(name)) return reply(cb, 'Names are 2–16 letters (spaces, \' and - allowed)');
        const cls = CLASSES[d.cls] ? d.cls : 'knight';
        const list = await db.listCharacters(aid);
        if (list.length >= MAX_CHARS) return reply(cb, `You can have ${MAX_CHARS} heroes`);
        const id = await db.createCharacter(aid, newCharacter(name, cls));
        reply(cb, null, { id });
      } catch (e) { console.error(e); reply(cb, 'Server error'); }
    });

    socket.on('deleteChar', async (d = {}, cb) => {
      try {
        if (online.has(`${aid}:${Number(d.id)}`)) return reply(cb, 'That hero is in a game right now');
        await db.deleteCharacter(aid, Number(d.id));
        reply(cb, null);
      } catch (e) { console.error(e); reply(cb, 'Server error'); }
    });

    socket.on('play', async (d = {}, cb) => {
      try {
        // Joining another party from inside a game: check it first, so a bad code doesn't drop you out.
        if (d.mode === 'join') {
          const target = parties.get(String(d.code || '').toUpperCase().trim());
          if (!target || target.solo) return reply(cb, 'No party with that code');
          if (member?.party === target) return reply(cb, "You're already in that party");
          if (target.full) return reply(cb, 'That party is full (4 players)');
        }
        if (member?.party) await member.party.remove(member);
        const charId = Number(d.charId);
        const char = await db.getCharacter(aid, charId);
        if (!char) return reply(cb, 'Hero not found');
        const key = `${aid}:${charId}`;
        // Same hero logged in elsewhere? Kick the old session.
        const old = online.get(key);
        if (old && old !== socket) { old.emit('kicked', { reason: 'This hero was opened somewhere else' }); old.disconnect(true); await new Promise((r) => setTimeout(r, 200)); }
        const fresh = online.get(key) ? await db.getCharacter(aid, charId) : char;
        let party;
        if (d.mode === 'join') {
          party = parties.get(String(d.code || '').toUpperCase().trim());
          if (!party || party.solo) return reply(cb, 'No party with that code');
          if (party.full) return reply(cb, 'That party is full (4 players)');
        } else {
          party = new Party(io, db, { solo: d.mode === 'solo', listed: d.mode === 'host' && !!d.listed });
        }
        online.set(key, socket);
        member = new Member({ pid: String(pidSeq++), socket, accountId: aid, charId, char: fresh || char });
        member.onlineKey = key;
        reply(cb, null, { pid: member.pid, code: party.code, solo: party.solo, char: member.char, next: xpToNext(member.char.level), derived: derive(member.char) });
        party.add(member);
        mailOnJoin(db, member);
      } catch (e) { console.error(e); reply(cb, 'Server error'); }
    });

    socket.on('leaveGame', async (cb) => {
      if (member?.party) await member.party.remove(member);
      if (member) online.delete(member.onlineKey);
      member = null;
      reply(cb, null);
    });

    // Gameplay
    socket.on('pos', (d) => member?.party?.zone?.onMove(member.pid, d));
    socket.on('atk', (d) => member?.party?.zone?.onAttack(member.pid, d));
    socket.on('skill', (d) => member?.party?.zone?.onSkill(member.pid, d));
    socket.on('potion', (d) => member?.party?.zone?.onPotion(member.pid, d));
    socket.on('pickup', (d) => member?.party?.zone?.onPickup(member.pid, d));
    socket.on('interact', (d) => member?.party?.zone?.onInteract(member.pid, d));
    socket.on('inv', inParty((d) => member.party.invAction(member.pid, d)));
    socket.on('gate', inParty((d) => {
      if (member.party.leader !== member.pid) return 'Only the leader can choose';
      const p = member.party.zone?.players.get(member.pid);
      const exit = member.party.zone?.map.exit;
      if (!p || member.party.zone.map.kind !== 'town' || Math.hypot(p.x - exit.x, p.y - exit.y) > 6) return 'Walk to the dungeon gate';
      member.party.requestTravel(member.pid, { kind: 'dungeon', floor: Number(d.floor) || 1 });
      return null;
    }));
    socket.on('ah', async (d, cb) => {
      if (typeof cb !== 'function') return;
      if (!member?.party) return cb({ error: 'Not in a game' });
      try { cb(await auctionAction(db, member, d || {})); } catch (e) { console.error('auction', e); cb({ error: 'Server error' }); }
    });
    for (const [ev, fn] of [['bank', bankAction], ['mail', mailAction]]) {
      socket.on(ev, async (d, cb) => {
        if (typeof cb !== 'function') return;
        if (!member?.party) return cb({ error: 'Not in a game' });
        try { cb(await fn(db, member, d || {})); } catch (e) { console.error(ev, e); cb({ error: 'Server error' }); }
      });
    }
    socket.on('duel', inParty((d) => duelAction(member.party, member, d)));
    // Group finder: anyone signed in can look; the leader lists or unlists their party.
    socket.on('groups', (d, cb) => { if (typeof cb === 'function') cb({ ok: true, groups: listGroups(), online: onlineCount(), mine: member?.party?.code || null }); });
    socket.on('listParty', inParty((d) => member.party.setListing(member.pid, d.on, d.note)));
    socket.emit('online', { n: onlineCount() });
    socket.on('chat', inParty((d) => {
      const text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (text) member.party.broadcast('chat', { pid: member.pid, name: member.char.name, text });
      return null;
    }));
    socket.on('admin', adminHandler({ io, db, socket }));
    socket.on('media', inParty((d) => { member.media = { mic: !!d.mic }; member.party.sendRoster(); return null; }));
    socket.on('rtc', inParty((d) => {
      const to = member.party.members.get(String(d.to));
      if (to) to.socket.emit('rtc', { from: member.pid, data: d.data });
      return null;
    }));

    // Developer shortcuts for testing (only when DEV_CMDS=1 is set; never on the live server).
    if (process.env.DEV_CMDS === '1') {
      socket.on('dev', inParty((d) => {
        const party = member.party; const p = party.zone?.players.get(member.pid);
        if (d.cmd === 'floor') party.goTo({ kind: 'dungeon', floor: Math.max(1, Number(d.floor) || 1) });
        if (d.cmd === 'town') party.goTo({ kind: 'town' });
        if (d.cmd === 'tp' && p) { p.x = Number(d.x); p.y = Number(d.y); member.socket.emit('correct', { x: p.x, y: p.y }); }
        if (d.cmd === 'xp') party.grantXp(member.pid, Number(d.n) || 100);
        if (d.cmd === 'gold') { member.char.gold += Number(d.n) || 1000; party.sendChar(member.pid); }
        if (d.cmd === 'mats') { const m = member.char.mats ||= {}; for (const [k, v] of Object.entries(d.mats || {})) m[k] = (m[k] || 0) + (Number(v) || 0); member.socket.emit('mats', { mats: m, got: { mat: Object.keys(d.mats || {})[0] || 'scrap', n: 0 } }); }
        if (d.cmd === 'item') {
          const it = makeItem(new RNG(Date.now() & 0xffffff), d.base || 'sword', Math.max(1, Number(d.ilvl) || member.char.level), d.rarity || 'rare');
          if (d.el) { for (const k of ['fire', 'frost', 'shock', 'poison']) delete it.mods[k]; it.mods[d.el] = Number(d.v) || 8; }
          const i = member.char.inv.findIndex((x) => !x); if (i >= 0) member.char.inv[i] = it;
          party.sendChar(member.pid);
        }
        if (d.cmd === 'wear') { for (const it of Object.values(member.char.equip)) if (it && it.slot !== 'ring' && it.slot !== 'amulet') { it.durMax ??= 50; it.dur = Math.max(0, Number(d.n) || 0); } party.zone?.refreshStats(member.pid); party.sendChar(member.pid); }
        if (d.cmd === 'debuff' && p) { const z = party.zone; if (d.slow) { p.slowUntil = z.time + Number(d.slow); } else z.debuffPlayer(p, String(d.type || 'spider'), Number(d.dmg) || 4); }
        if (d.cmd === 'mdebuff') { const z = party.zone; for (const e of z.ents.values()) if (e.k === 'm' && e.state !== 'dead') { e.stunUntil = z.time + 3; e.poison = { stacks: 3, per: 0, until: z.time + 6, by: member.pid }; e.chillUntil = e.slowUntil = z.time + 4; } }
        if (d.cmd === 'killboss' && p) { const z = party.zone; for (const e of z.ents.values()) if (e.k === 'm' && e.boss && e.state !== 'dead') { p.x = e.x + 1.5; p.y = e.y; member.socket.emit('correct', { x: p.x, y: p.y }); z.killMonster(e, p); } }
        return null;
      }));
    }

    socket.on('disconnect', async () => {
      if (member?.party) await member.party.remove(member, 'disconnect');
      if (member && online.get(member.onlineKey) === socket) online.delete(member.onlineKey);
      member = null;
    });
  });

  // Save everyone on shutdown (Render sends SIGTERM on deploys).
  const shutdown = async () => {
    console.log('Saving all heroes…');
    for (const p of parties.values()) await p.saveAll();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // "N online" on everyone's screen: push the count when it changes.
  let lastOnline = -1;
  const onlineTimer = setInterval(() => { const n = onlineCount(); if (n !== lastOnline) { lastOnline = n; io.emit('online', { n }); } }, 2000);
  onlineTimer.unref?.(); server.on('close', () => clearInterval(onlineTimer));
  await new Promise((r) => server.listen(port, r));
  console.log(`\n  ${GAME_TITLE} running on http://localhost:${server.address().port}\n`);
  return { server, io, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((e) => { console.error(e); process.exit(1); });
}
