// Duels: two members of the same party fight in the town arena for a gold stake.
// Both stakes are held by the server while the duel runs (and written to the heroes, so a crash
// refunds them on next login). Nobody dies: the hit that would kill ends the duel instead.
export const DUEL = { maxStake: 1000000, inviteSecs: 30, countdown: 3, timeLimit: 180, pvpDamage: 1.0 };

export function duelAction(party, member, d = {}) {
  const zone = party.zone;
  const me = member.pid;
  switch (d.op) {
    case 'challenge': {
      if (party.solo) return 'Duels need a party: host a game and share the code';
      if (!zone || zone.map.kind !== 'town') return 'Duels happen in the town arena';
      if (zone.duel || party.duelInvite) return 'A duel is already set up';
      const to = party.members.get(String(d.to));
      if (!to || to === member) return 'Pick another party member';
      const stake = Math.floor(Number(d.stake) || 0);
      if (stake < 0 || stake > DUEL.maxStake) return 'Invalid stake';
      if (member.char.gold < stake) return 'You don\'t have that much gold';
      if (to.char.gold < stake) return `${to.char.name} doesn't have ${stake.toLocaleString()} gold`;
      party.duelInvite = { from: me, to: to.pid, stake, expires: Date.now() + DUEL.inviteSecs * 1000 };
      clearTimeout(party.duelInviteTimer);
      party.duelInviteTimer = setTimeout(() => { if (party.duelInvite?.from === me) { party.duelInvite = null; party.emitTo(me, 'msg', { text: `${to.char.name} didn't answer the challenge`, kind: 'info' }); party.emitTo(to.pid, 'duelInvite', null); } }, DUEL.inviteSecs * 1000);
      party.emitTo(to.pid, 'duelInvite', { from: me, name: member.char.name, stake, secs: DUEL.inviteSecs });
      party.emitTo(me, 'msg', { text: `Challenge sent to ${to.char.name}`, kind: 'info' });
      return null;
    }
    case 'decline': case 'cancel': {
      const inv = party.duelInvite;
      if (!inv || (inv.to !== me && inv.from !== me)) return null;
      party.duelInvite = null; clearTimeout(party.duelInviteTimer);
      const other = inv.to === me ? inv.from : inv.to;
      party.emitTo(other, 'msg', { text: `${member.char.name} ${d.op === 'decline' ? 'declined' : 'withdrew'} the duel`, kind: 'info' });
      party.emitTo(other, 'duelInvite', null);
      return null;
    }
    case 'accept': {
      const inv = party.duelInvite;
      if (!inv || inv.to !== me) return 'That challenge has expired';
      party.duelInvite = null; clearTimeout(party.duelInviteTimer);
      const a = party.members.get(inv.from); const b = member;
      if (!a) return 'Your challenger left';
      if (!zone || zone.map.kind !== 'town' || !zone.map.arena) return 'Duels happen in the town arena';
      if (a.char.gold < inv.stake || b.char.gold < inv.stake) return 'Someone no longer has enough gold';
      for (const m of [a, b]) { m.char.gold -= inv.stake; m.char.duelEscrow = inv.stake; m.dirty = true; party.save(m); party.sendChar(m.pid); }
      zone.startDuel(a.pid, b.pid, inv.stake);
      return null;
    }
    default: return 'Unknown duel action';
  }
}

// Called by the zone when a duel finishes. winner: pid or null for a draw.
export function settleDuel(party, duel, winner) {
  const a = party.members.get(duel.a); const b = party.members.get(duel.b);
  for (const m of [a, b]) if (m) delete m.char.duelEscrow;
  if (winner) {
    const w = party.members.get(winner);
    if (w) w.char.gold += duel.stake * 2;
  } else {
    for (const m of [a, b]) if (m) m.char.gold += duel.stake;
  }
  for (const m of [a, b]) if (m) { m.dirty = true; party.save(m); party.sendChar(m.pid); }
}
