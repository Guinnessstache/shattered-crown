// Buff / debuff chips with a countdown: your own row above the vitals, and a monster's
// debuffs under its health bar. Times come from the server as "seconds left"; the chips count
// down locally. A chip's ring shows how much of its duration is left (the duration is taken
// as the time left when it was first seen or last refreshed).
import { STATUS } from '/shared/rules.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class StatusRow {
  constructor(el, { small = false } = {}) {
    this.el = el; this.small = small;
    this.items = new Map(); // id -> { until, max, n, chip, shown }
    this.sig = '';
  }

  // list: [{ id, until, n }] with absolute times (seconds, same clock as `t`).
  set(list, t) {
    const seen = new Set();
    for (const s of list) {
      if (!STATUS[s.id] || s.until <= t) continue;
      seen.add(s.id);
      const cur = this.items.get(s.id);
      if (!cur) this.items.set(s.id, { until: s.until, max: s.until - t, n: s.n || 0 });
      else {
        if (s.until > cur.until + 0.3) cur.max = s.until - t; // refreshed: full ring again
        cur.until = s.until; cur.n = s.n || 0;
      }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.items.delete(id);
  }

  // Called every frame.
  tick(t) {
    for (const [id, s] of this.items) if (s.until <= t) this.items.delete(id);
    const ids = [...this.items.keys()];
    // good things first, then debuffs, in a fixed order so chips don't jump around
    const order = Object.keys(STATUS);
    ids.sort((a, b) => (STATUS[b].good ? 1 : 0) - (STATUS[a].good ? 1 : 0) || order.indexOf(a) - order.indexOf(b));
    const sig = ids.join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.el.innerHTML = ids.map((id) => {
        const d = STATUS[id];
        return `<div class="st ${d.good ? 'good' : 'bad'}" data-st="${id}" title="${esc(`${d.name} — ${d.desc}`)}"><span class="ic">${d.icon}</span><b class="n"></b><i class="t"></i></div>`;
      }).join('');
      for (const c of this.el.children) { const s = this.items.get(c.dataset.st); if (s) { s.chip = c; s.shown = null; } }
      this.el.classList.toggle('hidden', !ids.length);
    }
    for (const s of this.items.values()) {
      if (!s.chip) continue;
      const left = s.until - t;
      const txt = left >= 10 ? `${Math.ceil(left)}` : left >= 1 ? `${Math.ceil(left)}` : left.toFixed(1);
      const key = `${txt}|${s.n}`;
      s.chip.style.setProperty('--p', `${Math.max(0, Math.min(1, left / Math.max(0.1, s.max))) * 360}deg`);
      if (key === s.shown) continue;
      s.shown = key;
      s.chip.querySelector('.t').textContent = txt;
      s.chip.querySelector('.n').textContent = s.n > 1 || (s.n && s.chip.dataset.st === 'ward') ? s.n : '';
      s.chip.classList.toggle('ending', left < 3);
    }
  }

  clear() { this.items.clear(); this.tick(0); }
}

// Snapshot form → list: [id, tenths left, stacks, id, tenths, stacks, ...]
export function parseDebuffs(db, t) {
  const out = [];
  if (!db) return out;
  for (let i = 0; i + 2 < db.length; i += 3) out.push({ id: db[i], until: t + db[i + 1] / 10, n: db[i + 2] });
  return out;
}
