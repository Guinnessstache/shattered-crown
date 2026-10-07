// Mail: letters between heroes with up to MAIL.maxItems items and some gold attached, sent and
// read at the mailbox in town. Sending takes the items and gold off the hero and stores the letter
// in one transaction; taking attachments is the same in reverse. Letters nobody collects go back
// to the sender after MAIL.keepDays.
import { MAIL, INV_SIZE, postage, CLASSES } from '../shared/rules.js';

let findOnline = null; // charId -> online member (set by index.js)
export function setMailOnlineLookup(fn) { findOnline = fn; }

let sweptAt = 0;
async function sweep(db) {
  if (Date.now() - sweptAt < 60_000) return;
  sweptAt = Date.now();
  try { await db.mailSweep(); } catch (e) { console.error('mail sweep', e); }
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').slice(0, n).trim();
const pubHero = (h) => ({ id: h.id, name: h.name, cls: h.cls, clsName: CLASSES[h.cls]?.name || h.cls, level: h.level, played: h.updated || null });

export async function mailAction(db, member, a = {}) {
  const party = member.party;
  if (a.op !== 'unread' && party.nearNpc(member.pid) !== 'mailbox') return { error: 'Find the mailbox in town' };
  if (member.mailBusy) return { error: 'One moment…' };
  member.mailBusy = true;
  try { return await run(db, member, a); } finally { member.mailBusy = false; }
}

async function run(db, m, a) {
  const ch = m.char; const party = m.party;
  const nInt = (v) => Math.floor(Number(v));
  switch (a.op) {
    case 'unread': return { unread: await db.mailUnread(m.charId) };
    case 'inbox': {
      await sweep(db);
      const rows = await db.mailInbox(m.charId);
      return { rows: rows.map(pub), unread: rows.filter((r) => !r.read).length };
    }
    // Who can I write to? Heroes with that exact name (names aren't unique, so the sender picks),
    // plus quick picks: party members and the other heroes on your account.
    case 'lookup': {
      const name = clean(a.name, 24);
      if (name.length < 2) return { heroes: [] };
      const heroes = (await db.heroesNamed(name)).filter((h) => h.id !== m.charId);
      return { heroes: heroes.map(pubHero) };
    }
    case 'contacts': {
      const out = [];
      for (const pm of party.members.values()) if (pm !== m) out.push({ ...pubHero({ id: pm.charId, name: pm.char.name, cls: pm.char.cls, level: pm.char.level }), why: 'party' });
      for (const h of await db.listCharacters(m.accountId)) if (h.id !== m.charId && !out.some((o) => o.id === h.id)) out.push({ ...pubHero(h), why: 'yours' });
      return { heroes: out };
    }
    case 'send': {
      const to = await db.heroBasic(nInt(a.to));
      if (!to) return { error: 'Pick who the letter is for' };
      if (to.id === m.charId) return { error: "You can't write to yourself" };
      const subject = clean(a.subject, MAIL.subjectMax) || '(no subject)';
      const body = String(a.body ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, MAIL.bodyMax);
      const idxs = [...new Set((Array.isArray(a.items) ? a.items : []).map(nInt))];
      if (idxs.length > MAIL.maxItems) return { error: `Up to ${MAIL.maxItems} items per letter` };
      if (idxs.some((i) => !(i >= 0 && i < INV_SIZE) || !ch.inv[i])) return { error: 'An attached item is no longer in your pack' };
      const gold = Math.max(0, nInt(a.gold) || 0);
      if (gold > MAIL.maxGold) return { error: 'That is too much gold for one letter' };
      const fee = postage(idxs.length);
      if (ch.gold < gold + fee) return { error: `You need ${(gold + fee).toLocaleString()} gold (including ${fee} postage)` };
      if (!body.trim() && !idxs.length && !gold && subject === '(no subject)') return { error: 'Write something, or attach an item or gold' };
      // Flood guard: 10 letters per 10 minutes.
      const now = Date.now();
      m.mailSent = (m.mailSent || []).filter((t) => now - t < 600_000);
      if (m.mailSent.length >= 10) return { error: 'The courier needs a rest. Try again in a few minutes' };

      const before = { inv: ch.inv.slice(), gold: ch.gold };
      const items = idxs.map((i) => ch.inv[i]);
      for (const i of idxs) ch.inv[i] = null;
      ch.gold -= gold + fee;
      try {
        await party.commit(m, () => db.mailSend({ toChar: to.id, toName: to.name, fromChar: m.charId, fromName: ch.name, subject, body, items, gold }, m.accountId, m.charId, ch));
      } catch (e) { ch.inv = before.inv; ch.gold = before.gold; party.sendChar(m.pid); throw e; }
      m.mailSent.push(now);
      party.sendChar(m.pid);
      notify(db, to.id, ch.name);
      return { ok: `Letter sent to ${to.name}${fee ? ` (${fee} gold postage)` : ''}` };
    }
    case 'read': {
      await db.mailMarkRead(nInt(a.id), m.charId);
      return { ok: null };
    }
    // Take one item (a.item = index on the letter), the gold (a.gold), or everything (a.all).
    case 'take': {
      const id = nInt(a.id);
      let took = []; let tookGold = 0; let full = false;
      const before = { inv: ch.inv.slice(), gold: ch.gold };
      let out;
      try {
        out = await party.commit(m, () => db.mailTake(id, m.charId, m.accountId, (letter) => {
          const items = letter.items.slice();
          const want = a.all ? items.map((_, i) => i) : Number.isInteger(a.item) ? [a.item] : [];
          for (const i of want.sort((x, y) => y - x)) {
            if (!items[i]) continue;
            const free = ch.inv.findIndex((x) => !x);
            if (free < 0) { full = true; break; }
            ch.inv[free] = items[i]; took.push(items[i]); items.splice(i, 1);
          }
          let gold = letter.gold;
          if ((a.all || a.gold) && gold > 0) { ch.gold += gold; tookGold = gold; gold = 0; }
          if (!took.length && !tookGold) return { error: full ? 'Your pack is full' : 'Nothing to take' };
          return { items, gold, charData: ch };
        }));
      } catch (e) { ch.inv = before.inv; ch.gold = before.gold; party.sendChar(m.pid); throw e; }
      if (out.error) { ch.inv = before.inv; ch.gold = before.gold; return out; }
      party.sendChar(m.pid);
      const what = [took.length ? took.map((t) => t.name).join(', ') : '', tookGold ? `${tookGold.toLocaleString()} gold` : ''].filter(Boolean).join(' and ');
      return { ok: `Took ${what}${full ? '. Your pack is full, the rest stays on the letter' : ''}`, full };
    }
    case 'delete': {
      const ok = await db.mailDelete(nInt(a.id), m.charId);
      return ok ? { ok: 'Letter thrown away' } : { error: 'Take the items and gold off the letter first' };
    }
    case 'return': {
      const r = await db.mailReturn(nInt(a.id), m.charId);
      if (!r) return { error: "That letter can't be sent back" };
      notify(db, r.toChar, ch.name, true);
      return { ok: `Sent back to ${r.toName}` };
    }
    default: return { error: 'Unknown action' };
  }
}

function pub(r) {
  return { id: r.id, from: r.fromName, fromChar: r.fromChar, subject: r.subject, body: r.body, items: r.items, gold: r.gold, created: r.created, read: r.read, returned: r.returned };
}

// Tell the recipient straight away if they're playing.
async function notify(db, charId, fromName, returned = false) {
  const rm = findOnline?.(charId);
  if (!rm) return;
  rm.socket.emit('msg', { text: returned ? `${fromName} sent your letter back. It's waiting at the mailbox.` : `New letter from ${fromName}! Read it at the mailbox in town.`, kind: 'good' });
  try { rm.socket.emit('mailNotice', { unread: await db.mailUnread(charId) }); } catch { /* ignore */ }
}

// On joining a game: let the hero know about unread letters.
export async function mailOnJoin(db, member) {
  try {
    const n = await db.mailUnread(member.charId);
    member.socket.emit('mailNotice', { unread: n, join: true });
  } catch (e) { console.error('mail unread', e); }
}
