// Auction house: heroes list items for gold, anyone can buy, sellers collect their gold later.
// Listings live in the database (not in a party), so they're shared by every player on the server.
// The item leaves the seller's pack when listed and the hero is saved straight away; a sale is a
// single conditional database update, so the same listing can never be sold twice.
import { AUCTION, CLASSES, INV_SIZE, SLOTS } from '../shared/rules.js';

const RARITIES = ['common', 'magic', 'rare', 'legendary'];

export async function auctionAction(db, member, a = {}) {
  const party = member.party;
  if (party.nearNpc(member.pid) !== 'auctioneer') return { error: 'Find the broker in town to use the auction house' };
  if (member.ahBusy) return { error: 'One moment…' };
  member.ahBusy = true;
  try { return await run(db, member, a); } finally { member.ahBusy = false; }
}

async function run(db, m, a) {
  const ch = m.char; const party = m.party;
  const saveNow = async () => { m.dirty = true; await party.save(m); party.sendChar(m.pid); };
  switch (a.op) {
    case 'search': {
      const page = Math.max(0, Math.min(500, Number(a.page) || 0));
      const rows = await db.ahSearch({
        slot: SLOTS.includes(a.slot) ? a.slot : null,
        rarity: RARITIES.includes(a.rarity) ? a.rarity : null,
        maxReq: a.usable ? ch.level : null,
        noSlot: a.usable && CLASSES[ch.cls]?.noShield ? 'offhand' : null,
        sort: String(a.sort || ''),
        offset: page * AUCTION.pageSize, limit: AUCTION.pageSize,
      });
      return { rows: rows.slice(0, AUCTION.pageSize).map((r) => pub(r, m.charId)), more: rows.length > AUCTION.pageSize, page };
    }
    case 'mine': {
      const rows = await db.ahMine(m.charId);
      return { rows: rows.map((r) => pub(r, m.charId)), owed: owed(rows) };
    }
    case 'list': {
      const idx = Number(a.idx); const price = Math.floor(Number(a.price));
      if (!Number.isInteger(idx) || idx < 0 || idx >= INV_SIZE || !ch.inv[idx]) return { error: 'Pick an item from your pack' };
      if (!(price >= 1 && price <= AUCTION.maxPrice)) return { error: `Price must be between 1 and ${AUCTION.maxPrice.toLocaleString()}` };
      const mine = await db.ahMine(m.charId);
      if (mine.filter((r) => r.status === 'active').length >= AUCTION.maxListings) return { error: `You can only have ${AUCTION.maxListings} items listed at once` };
      const item = ch.inv[idx];
      ch.inv[idx] = null;
      try { await db.ahCreate({ sellerChar: m.charId, sellerName: ch.name, item, price }); } catch (e) { ch.inv[idx] ||= item; throw e; }
      await saveNow();
      return { ok: `Listed ${item.name} for ${price.toLocaleString()} gold` };
    }
    case 'buy': {
      const id = Number(a.id);
      const free = ch.inv.findIndex((x) => !x);
      if (free < 0) return { error: 'Your pack is full' };
      const price = Number(a.price);
      if (!(ch.gold >= price)) return { error: 'Not enough gold' };
      const r = await db.ahBuy(id, m.charId, ch.name);
      if (!r) return { error: 'Someone else got there first' };
      // The listing may have been relisted at a different price since the buyer last looked.
      if (r.price !== price || ch.gold < r.price) { await db.ahUnbuy(id); return { error: 'The price has changed, refresh and try again' }; }
      ch.gold -= r.price;
      ch.inv[free] = r.item;
      await saveNow();
      notifySeller(party, r);
      return { ok: `Bought ${r.item.name}`, item: r.item };
    }
    case 'cancel': {
      const free = ch.inv.findIndex((x) => !x);
      if (free < 0) return { error: 'Make room in your pack first' };
      const r = await db.ahCancel(Number(a.id), m.charId);
      if (!r) return { error: 'That listing has already sold' };
      ch.inv[free] = r.item;
      await saveNow();
      return { ok: `${r.item.name} is back in your pack` };
    }
    case 'collect': {
      const rows = await db.ahCollect(m.charId);
      const gold = owed(rows);
      if (!gold) return { error: 'Nothing to collect yet' };
      ch.gold += gold;
      await saveNow();
      return { ok: `Collected ${gold.toLocaleString()} gold from ${rows.length} sale${rows.length > 1 ? 's' : ''}`, gold };
    }
    default: return { error: 'Unknown action' };
  }
}

const owed = (rows) => rows.filter((r) => r.status === 'sold' || r.status === 'collected').reduce((s, r) => s + payout(r.price), 0);
export const payout = (price) => price - Math.ceil(price * AUCTION.cut);

function pub(r, myChar) {
  return { id: r.id, item: r.item, price: r.price, seller: r.seller, mine: r.sellerChar === myChar, status: r.status, buyer: r.buyer || null };
}

// Tell the seller right away if they're online (in any party on this server).
let findOnline = null;
export function setOnlineLookup(fn) { findOnline = fn; }
function notifySeller(_party, r) {
  const sm = findOnline?.(r.sellerChar);
  sm?.socket.emit('msg', { text: `Your ${r.item.name} sold for ${r.price.toLocaleString()} gold! Collect it from the broker.`, kind: 'good' });
}
