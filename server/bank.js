// The bank: item slots and gold shared by every hero on an account. Talk to Odo the Banker.
// Every change reads the bank fresh, changes the hero and the bank together and writes both in
// one transaction (see db.bankSave). Changes for one account run one at a time, so two heroes
// from the same account using the bank at once can't overwrite each other.
import { BANK, INV_SIZE } from '../shared/rules.js';

const locks = new Map(); // accountId -> promise of the last queued bank change
function withAccountLock(aid, fn) {
  const run = (locks.get(aid) || Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  locks.set(aid, tail);
  tail.then(() => { if (locks.get(aid) === tail) locks.delete(aid); });
  return run;
}

export function emptyBank() { return { tabs: 1, slots: Array(BANK.tabSize).fill(null), gold: 0 }; }
function normalize(b) {
  const bank = b || emptyBank();
  bank.tabs = Math.max(1, Math.min(BANK.maxTabs, bank.tabs | 0));
  const n = bank.tabs * BANK.tabSize;
  bank.slots = Array.from({ length: n }, (_, i) => bank.slots?.[i] || null);
  bank.gold = Math.max(0, Math.floor(Number(bank.gold) || 0));
  return bank;
}

export async function bankAction(db, member, a = {}) {
  const party = member.party;
  if (party.nearNpc(member.pid) !== 'banker') return { error: 'Find the banker in town to use your bank' };
  return withAccountLock(member.accountId, () => run(db, member, a));
}

async function run(db, m, a) {
  const ch = m.char; const party = m.party;
  const bank = normalize(await db.bankGet(m.accountId));
  const view = () => ({ bank: { tabs: bank.tabs, slots: bank.slots, gold: bank.gold } });
  if (a.op === 'open') return view();

  // Change the hero and the bank, then write both together; put the hero back if the write fails.
  const before = { inv: ch.inv.slice(), gold: ch.gold };
  const commit = async (ok) => {
    try {
      await party.commit(m, () => db.bankSave(m.accountId, bank, m.charId, ch));
    } catch (e) {
      ch.inv = before.inv; ch.gold = before.gold;
      party.sendChar(m.pid);
      throw e;
    }
    party.sendChar(m.pid);
    return { ok, ...view() };
  };
  const nInt = (v) => Math.floor(Number(v));

  switch (a.op) {
    case 'deposit': {
      const idx = nInt(a.idx);
      if (!(idx >= 0 && idx < INV_SIZE) || !ch.inv[idx]) return { error: 'Pick an item from your pack', ...view() };
      let to = Number.isInteger(a.to) ? a.to : -1;
      if (!(to >= 0 && to < bank.slots.length) || bank.slots[to]) {
        // first free slot, starting with the tab the player is looking at
        const start = Math.max(0, Math.min(bank.tabs - 1, nInt(a.tab) || 0)) * BANK.tabSize;
        const len = bank.slots.length;
        to = -1;
        for (let k = 0; k < len && to < 0; k++) if (!bank.slots[(start + k) % len]) to = (start + k) % len;
      }
      if (to < 0) return { error: bank.tabs < BANK.maxTabs ? 'Your bank is full. Buy another tab to make room' : 'Your bank is full', ...view() };
      const it = ch.inv[idx];
      bank.slots[to] = it; ch.inv[idx] = null;
      return commit(`${it.name} stored in the bank`);
    }
    case 'withdraw': {
      const slot = nInt(a.slot);
      const it = bank.slots[slot];
      if (!it) return { error: 'That slot is empty', ...view() };
      let to = Number.isInteger(a.to) && a.to >= 0 && a.to < INV_SIZE && !ch.inv[a.to] ? a.to : ch.inv.findIndex((x) => !x);
      if (to < 0) return { error: 'Your pack is full', ...view() };
      ch.inv[to] = it; bank.slots[slot] = null;
      return commit(`${it.name} taken from the bank`);
    }
    case 'move': { // rearrange inside the bank (swap two slots)
      const from = nInt(a.from); const to = nInt(a.to);
      if (!(from >= 0 && from < bank.slots.length && to >= 0 && to < bank.slots.length) || from === to || !bank.slots[from]) return { error: 'Nothing to move', ...view() };
      [bank.slots[from], bank.slots[to]] = [bank.slots[to], bank.slots[from]];
      return commit(null);
    }
    case 'depositGold': {
      const n = nInt(a.n);
      if (!(n > 0)) return { error: 'Enter an amount', ...view() };
      if (n > ch.gold) return { error: "You don't have that much gold", ...view() };
      if (bank.gold + n > BANK.maxGold) return { error: 'The bank can\'t hold that much gold', ...view() };
      ch.gold -= n; bank.gold += n;
      return commit(`Deposited ${n.toLocaleString()} gold`);
    }
    case 'withdrawGold': {
      const n = nInt(a.n);
      if (!(n > 0)) return { error: 'Enter an amount', ...view() };
      if (n > bank.gold) return { error: 'Your bank doesn\'t hold that much gold', ...view() };
      bank.gold -= n; ch.gold += n;
      return commit(`Withdrew ${n.toLocaleString()} gold`);
    }
    case 'buyTab': {
      if (bank.tabs >= BANK.maxTabs) return { error: 'You have every tab already', ...view() };
      const cost = BANK.tabCost[bank.tabs];
      if (ch.gold < cost) return { error: `A new tab costs ${cost.toLocaleString()} gold`, ...view() };
      ch.gold -= cost; bank.tabs += 1;
      bank.slots = bank.slots.concat(Array(BANK.tabSize).fill(null));
      return commit(`Bought bank tab ${bank.tabs}`);
    }
    default: return { error: 'Unknown action', ...view() };
  }
}
