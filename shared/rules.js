// Game rules shared by the server (authority) and the browser (tooltips, character sheet).
import { RNG } from './rng.js';

export const GAME_TITLE = 'Shattered Crown';
export const MAX_LEVEL = 60;
export const INV_SIZE = 30;
export const MAX_POTIONS = 15;
export const PARTY_MAX = 4;
export const SLOTS = ['weapon', 'offhand', 'head', 'chest', 'hands', 'feet', 'ring', 'amulet'];
export const SLOT_NAMES = { weapon: 'Weapon', offhand: 'Shield', head: 'Helm', chest: 'Armor', hands: 'Gloves', feet: 'Boots', ring: 'Ring', amulet: 'Amulet' };
export const RARITY = ['common', 'magic', 'rare', 'legendary'];
export const RARITY_COLOR = { common: '#e8e2d4', magic: '#6aa8ff', rare: '#ffd84a', legendary: '#ff8a2a' };

const round = Math.round;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- classes
export const CLASSES = {
  knight: {
    icon: '🛡',
    name: 'Knight',
    blurb: 'Sword and shield. Takes the hits so the party doesn\'t have to.',
    base: { str: 15, dex: 10, vit: 14, spi: 8 },
    grow: { str: 1, dex: 1, vit: 1, spi: 1 },
    skills: ['cleave', 'bash', 'charge', 'warcry'],
    starter: { weapon: 'sword', offhand: 'shield', chest: 'chest' },
    starterName: 'Rusty Sword',
    power: 'str', // the stat that boosts damage
  },
  berserker: {
    icon: '🪓',
    name: 'Berserker',
    blurb: 'A big axe and no fear. Hits hardest, heals by hurting things, wears little armor.',
    base: { str: 17, dex: 13, vit: 12, spi: 6 },
    grow: { str: 1, dex: 1, vit: 1, spi: 1 },
    skills: ['frenzy', 'leap', 'whirlwind', 'bloodlust'],
    starter: { weapon: 'greataxe', chest: 'chest' },
    starterName: 'Notched Greataxe',
    power: 'str',
    noShield: true, // fights two-handed; shields don't suit him
  },
  alchemist: {
    icon: '⚗',
    name: 'Alchemist',
    blurb: 'Hurls bolts and explosive brews from range, and bends fire, frost and acid.',
    base: { str: 7, dex: 12, vit: 11, spi: 17 },
    grow: { str: 1, dex: 1, vit: 1, spi: 1 },
    skills: ['flask', 'nova', 'acid', 'ward'],
    starter: { weapon: 'staff', chest: 'chest' },
    starterName: 'Cracked Staff',
    power: 'spi',
    ranged: true, // basic attack throws a bolt instead of swinging
  },
  druid: {
    icon: '🌿',
    name: 'Druid',
    blurb: 'Calls on the wild: thorns, grasping roots, a spirit wolf, and healing for the whole party.',
    base: { str: 10, dex: 10, vit: 14, spi: 14 },
    grow: { str: 1, dex: 1, vit: 1, spi: 1 },
    skills: ['thorns', 'entangle', 'wolf', 'rejuv'],
    starter: { weapon: 'staff', chest: 'chest' },
    starterName: 'Gnarled Staff',
    power: 'spi',
  },
};
export const FREE_POINTS_PER_LEVEL = 3;

export const SKILLS = {
  cleave: {
    name: 'Cleave', key: 1, unlock: 1, max: 10, icon: '⚔',
    desc: (r) => `A wide, heavy swing hitting everything in front of you for ${150 + 15 * (r - 1)}% weapon damage.`,
    mana: (r) => 7 + r, cd: 2.2, range: 3.0, arc: 200, mult: (r) => 1.5 + 0.15 * (r - 1),
  },
  bash: {
    name: 'Shield Bash', key: 2, unlock: 2, max: 10, icon: '🛡', needsShield: true,
    desc: (r) => `Slam enemies in front of you with your shield for ${120 + 12 * (r - 1)}% damage, knocking them back and stunning them for ${(1.2 + 0.15 * (r - 1)).toFixed(1)}s. Needs a shield.`,
    mana: (r) => 6 + r, cd: 4.5, range: 2.6, arc: 80, mult: (r) => 1.2 + 0.12 * (r - 1), stun: (r) => 1.2 + 0.15 * (r - 1),
  },
  charge: {
    name: 'Charge', key: 3, unlock: 4, max: 10, icon: '➶',
    desc: (r) => `Rush ${(7 + 0.4 * (r - 1)).toFixed(1)}m forward, striking everything in your path for ${100 + 15 * (r - 1)}% damage.`,
    mana: (r) => 10 + r, cd: 6, dist: (r) => 7 + 0.4 * (r - 1), mult: (r) => 1 + 0.15 * (r - 1),
  },
  warcry: {
    name: 'War Cry', key: 4, unlock: 6, max: 10, icon: '📯',
    desc: (r) => `Rally the party: +${20 + 5 * (r - 1)}% damage and +${15 + 5 * (r - 1)} armor for 12s. Nearby enemies are slowed.`,
    mana: (r) => 16 + 2 * r, cd: 20, radius: 9, dmg: (r) => 0.2 + 0.05 * (r - 1), armor: (r) => 15 + 5 * (r - 1), dur: 12,
  },

  // ---- Berserker
  frenzy: {
    name: 'Frenzy', key: 1, unlock: 1, max: 10, icon: '🪓', anim: 'frenzy',
    desc: (r) => `Two furious strikes in quick succession, each dealing ${pc(0.85 + 0.08 * (r - 1))}% weapon damage.`,
    mana: (r) => 5 + r, cd: 1.6, range: 2.8, arc: 120, mult: (r) => 0.85 + 0.08 * (r - 1),
  },
  leap: {
    name: 'Leap', key: 2, unlock: 2, max: 10, icon: '⤴', anim: 'leap',
    desc: (r) => `Leap up to ${(6 + 0.3 * (r - 1)).toFixed(1)}m and crash down, hitting everything nearby for ${pc(1.3 + 0.13 * (r - 1))}% damage and stunning them.`,
    mana: (r) => 9 + r, cd: 6, dist: (r) => 6 + 0.3 * (r - 1), radius: 2.6, mult: (r) => 1.3 + 0.13 * (r - 1), stun: 0.8,
  },
  whirlwind: {
    name: 'Whirlwind', key: 3, unlock: 4, max: 10, icon: '🌀', anim: 'whirlwind',
    desc: (r) => `Spin with your weapon out, hitting everything around you 4 times for ${pc(0.55 + 0.06 * (r - 1))}% damage each.`,
    mana: (r) => 12 + r, cd: 7, radius: 3, pulses: 4, mult: (r) => 0.55 + 0.06 * (r - 1),
  },
  bloodlust: {
    name: 'Bloodlust', key: 4, unlock: 6, max: 10, icon: '🩸', anim: 'warcry',
    desc: (r) => `Fly into a rage for 10s: +${25 + 5 * (r - 1)}% attack speed and ${5 + (r - 1)}% of damage dealt returned as life.`,
    mana: (r) => 14 + 2 * r, cd: 22, dur: 10, atkSpd: (r) => 25 + 5 * (r - 1), lifeSteal: (r) => 5 + (r - 1),
  },

  // ---- Alchemist
  flask: {
    name: 'Fire Flask', key: 1, unlock: 1, max: 10, icon: '🧪', anim: 'cast',
    desc: (r) => `Throw a flask that bursts into flame, hitting everything within 2.2m for ${pc(1.3 + 0.13 * (r - 1))}% damage.`,
    mana: (r) => 5 + r, cd: 1.4, speed: 13, life: 0.8, radius: 2.2, mult: (r) => 1.3 + 0.13 * (r - 1),
  },
  nova: {
    name: 'Frost Nova', key: 2, unlock: 2, max: 10, icon: '❄', anim: 'cast',
    desc: (r) => `A ring of frost bursts from you, dealing ${pc(0.8 + 0.08 * (r - 1))}% damage, freezing enemies for ${(1.2 + 0.1 * (r - 1)).toFixed(1)}s and slowing them after.`,
    mana: (r) => 10 + r, cd: 7, radius: 4.5, mult: (r) => 0.8 + 0.08 * (r - 1), stun: (r) => 1.2 + 0.1 * (r - 1),
  },
  acid: {
    name: 'Acid Pool', key: 3, unlock: 4, max: 10, icon: '☣', anim: 'cast',
    desc: (r) => `Splash a pool of acid ahead of you that burns enemies standing in it for ${pc(0.3 + 0.03 * (r - 1))}% damage twice a second for 5s.`,
    mana: (r) => 12 + r, cd: 8, dist: 5, radius: 2.6, dur: 5, mult: (r) => 0.3 + 0.03 * (r - 1),
  },
  ward: {
    name: 'Arcane Ward', key: 4, unlock: 6, max: 10, icon: '🔮', anim: 'warcry',
    desc: (r) => `Shield yourself and nearby allies for 12s, absorbing ${25 + 10 * (r - 1)} damage plus 1.5× your Spirit.`,
    mana: (r) => 15 + 2 * r, cd: 18, radius: 9, dur: 12, absorb: (r, spi) => Math.round(25 + 10 * (r - 1) + spi * 1.5),
  },

  // ---- Druid
  thorns: {
    name: 'Thorn Volley', key: 1, unlock: 1, max: 10, icon: '🌿', anim: 'cast',
    desc: (r) => `Fling a fan of 5 thorns, each dealing ${pc(0.55 + 0.05 * (r - 1))}% damage.`,
    mana: (r) => 5 + r, cd: 1.6, count: 5, spread: 0.6, speed: 15, life: 0.6, mult: (r) => 0.55 + 0.05 * (r - 1),
  },
  entangle: {
    name: 'Entangle', key: 2, unlock: 2, max: 10, icon: '🌱', anim: 'cast',
    desc: (r) => `Roots burst from the ground ahead, dealing ${pc(0.6 + 0.06 * (r - 1))}% damage and holding enemies in place for ${(2 + 0.2 * (r - 1)).toFixed(1)}s.`,
    mana: (r) => 9 + r, cd: 7, dist: 5, radius: 3, mult: (r) => 0.6 + 0.06 * (r - 1), stun: (r) => 2 + 0.2 * (r - 1),
  },
  wolf: {
    name: 'Spirit Wolf', key: 3, unlock: 4, max: 10, icon: '🐺', anim: 'warcry',
    desc: (r) => `Summon a spirit wolf for 30s. It hunts nearby enemies, biting for ${pc(0.55 + 0.06 * (r - 1))}% of your damage.`,
    mana: (r) => 18 + 2 * r, cd: 25, dur: 30, mult: (r) => 0.55 + 0.06 * (r - 1),
  },
  rejuv: {
    name: 'Rejuvenation', key: 4, unlock: 6, max: 10, icon: '✚', anim: 'cast',
    desc: (r) => `Heal yourself and allies within 9m for 10% of their life at once, then ${20 + 4 * (r - 1)}% more over 6s.`,
    mana: (r) => 16 + 2 * r, cd: 16, radius: 9, dur: 6, hot: (r) => 0.2 + 0.04 * (r - 1),
  },
};
function pc(x) { return Math.round(x * 100); }

export function xpToNext(level) { return round(90 * Math.pow(level, 1.6)); }

// ---------------------------------------------------------------- items
export const BASES = {
  // weapons: dmg multiplier, attack interval (s), reach (m)
  sword: { slot: 'weapon', kind: 'sword', names: ['Short Sword', 'Broadsword', 'Knight\'s Blade', 'Runed Longsword', 'Dread Blade', 'Kingsfall'], dmg: 1.0, speed: 0.52, reach: 2.4 },
  axe: { slot: 'weapon', kind: 'axe', names: ['Hatchet', 'War Axe', 'Bearded Axe', 'Reaver', 'Doom Axe', 'Worldsplitter'], dmg: 1.12, speed: 0.6, reach: 2.3 },
  mace: { slot: 'weapon', kind: 'mace', names: ['Club', 'Flanged Mace', 'Morningstar', 'Bonebreaker', 'Grave Maul', 'Sunhammer'], dmg: 1.18, speed: 0.64, reach: 2.2, stunChance: 0.08 },
  staff: { slot: 'weapon', kind: 'staff', names: ['Quarterstaff', 'Oak Staff', 'Runed Staff', 'Spirit Staff', 'Grave Staff', 'Staff of Embers'], dmg: 1.08, speed: 0.6, reach: 2.6 },
  // Two-handed: harder hits and longer reach, but no shield (equipping one moves the shield to the pack).
  greataxe: { slot: 'weapon', kind: 'greataxe', twoHanded: true, names: ['Woodsman\'s Axe', 'Great Axe', 'Executioner', 'Ravager', 'Doom Cleaver', 'Worldcleaver'], dmg: 1.45, speed: 0.78, reach: 2.7, drop: 0.75 },
  greatsword: { slot: 'weapon', kind: 'greatsword', twoHanded: true, names: ['Claymore', 'Greatsword', 'Zweihander', 'Runed Greatblade', 'Dread Zweihander', 'Kingslayer'], dmg: 1.35, speed: 0.72, reach: 2.9, drop: 0.75 },
  maul: { slot: 'weapon', kind: 'maul', twoHanded: true, names: ['Sledge', 'War Maul', 'Spiked Maul', 'Bonecrusher', 'Grave Hammer', 'Mountainbreaker'], dmg: 1.55, speed: 0.85, reach: 2.5, stunChance: 0.14, drop: 0.75 },
  shield: { slot: 'offhand', kind: 'shield', names: ['Buckler', 'Kite Shield', 'Tower Shield', 'Aegis', 'Bulwark', 'Dragonguard'], armor: 1.0, block: [10, 26] },
  helm: { slot: 'head', kind: 'helm', names: ['Leather Cap', 'Iron Helm', 'Great Helm', 'Winged Helm', 'Dread Visage', 'Crown of Ash'], armor: 0.8 },
  chest: { slot: 'chest', kind: 'chest', names: ['Padded Jerkin', 'Chain Mail', 'Scale Hauberk', 'Plate Cuirass', 'Gothic Plate', 'Ember Plate'], armor: 1.6 },
  gloves: { slot: 'hands', kind: 'gloves', names: ['Leather Gloves', 'Chain Gloves', 'Gauntlets', 'War Gauntlets', 'Dread Grips', 'Ember Fists'], armor: 0.55 },
  boots: { slot: 'feet', kind: 'boots', names: ['Leather Boots', 'Chain Boots', 'Greaves', 'War Greaves', 'Dread Treads', 'Ember Striders'], armor: 0.6 },
  ring: { slot: 'ring', kind: 'ring', names: ['Copper Ring', 'Silver Ring', 'Gold Ring', 'Signet', 'Runed Band', 'Sunstone Ring'] },
  amulet: { slot: 'amulet', kind: 'amulet', names: ['Bone Charm', 'Silver Pendant', 'Gold Amulet', 'Talisman', 'Runed Torc', 'Heart of Embers'] },
};
const tierOf = (ilvl) => clamp(Math.floor((ilvl - 1) / 6), 0, 5);

// Affixes: stat, how it rolls at an item level, where it can appear, and its name.
const MODS = {
  str: { roll: (r, l) => r.int(1, 3 + Math.floor(l / 4)), pre: 'Mighty', suf: 'of Might', fmt: (v) => `+${v} Strength` },
  dex: { roll: (r, l) => r.int(1, 3 + Math.floor(l / 4)), pre: 'Deft', suf: 'of the Fox', fmt: (v) => `+${v} Dexterity` },
  vit: { roll: (r, l) => r.int(1, 3 + Math.floor(l / 4)), pre: 'Hale', suf: 'of the Bear', fmt: (v) => `+${v} Vitality` },
  spi: { roll: (r, l) => r.int(1, 3 + Math.floor(l / 4)), pre: 'Glowing', suf: 'of the Sage', fmt: (v) => `+${v} Spirit` },
  life: { roll: (r, l) => r.int(4, 10 + l * 2), pre: 'Stout', suf: 'of Life', fmt: (v) => `+${v} Life` },
  mana: { roll: (r, l) => r.int(3, 6 + l), pre: 'Arcane', suf: 'of Focus', fmt: (v) => `+${v} Mana` },
  dmgPct: { roll: (r, l) => r.int(6, 14 + Math.floor(l * 1.2)), pre: 'Brutal', suf: 'of Slaughter', fmt: (v) => `+${v}% Damage`, only: ['weapon', 'ring', 'amulet', 'hands'] },
  armor: { roll: (r, l) => r.int(3, 6 + Math.floor(l * 1.5)), pre: 'Sturdy', suf: 'of Warding', fmt: (v) => `+${v} Armor`, not: ['weapon'] },
  lifeSteal: { roll: (r) => r.int(1, 4), pre: 'Vampiric', suf: 'of the Leech', fmt: (v) => `${v}% Life Steal`, only: ['weapon', 'ring', 'amulet'] },
  atkSpd: { roll: (r) => r.int(5, 15), pre: 'Swift', suf: 'of Haste', fmt: (v) => `+${v}% Attack Speed`, only: ['weapon', 'hands', 'ring'] },
  moveSpd: { roll: (r) => r.int(5, 14), pre: 'Fleet', suf: 'of the Wind', fmt: (v) => `+${v}% Move Speed`, only: ['feet'] },
  crit: { roll: (r) => r.int(2, 7), pre: 'Keen', suf: 'of Precision', fmt: (v) => `+${v}% Critical Chance`, only: ['weapon', 'ring', 'amulet', 'head', 'hands'] },
  regen: { roll: (r, l) => +(r.float(0.5, 1.5 + l * 0.12)).toFixed(1), pre: 'Mending', suf: 'of Renewal', fmt: (v) => `+${v} Life per second`, not: ['weapon'] },
  gold: { roll: (r) => r.int(10, 40), pre: 'Gilded', suf: 'of Greed', fmt: (v) => `+${v}% Gold Found`, only: ['ring', 'amulet', 'head', 'hands'] },
  block: { roll: (r) => r.int(3, 8), pre: 'Guarding', suf: 'of the Wall', fmt: (v) => `+${v}% Block Chance`, only: ['offhand'] },
  thorns: { roll: (r, l) => r.int(2, 5 + l), pre: 'Spiked', suf: 'of Thorns', fmt: (v) => `Reflects ${v} damage to melee attackers`, only: ['chest', 'offhand', 'head'] },
  // Elements: only on weapons, and added on top of the normal bonuses (see makeItem).
  fire: { elem: true, roll: (r, l) => r.int(2, 4 + Math.floor(l * 0.9)), pre: 'Flaming', suf: 'of Embers', fmt: (v) => `+${v} Fire Damage · sets enemies ablaze (${v} more over 2s)` },
  frost: { elem: true, roll: (r, l) => r.int(2, 4 + Math.floor(l * 0.8)), pre: 'Frozen', suf: 'of Winter', fmt: (v) => `+${v} Cold Damage · chills enemies (45% slower)` },
  shock: { elem: true, roll: (r, l) => r.int(2, 4 + Math.floor(l * 0.9)), pre: 'Shocking', suf: 'of Storms', fmt: (v) => `+${v} Lightning Damage · 20% chance to arc to another enemy for ${v * 2}` },
  poison: { elem: true, roll: (r, l) => r.int(2, 4 + Math.floor(l * 0.8)), pre: 'Venomous', suf: 'of the Viper', fmt: (v) => `+${v} Poison Damage · poisons for ${Math.round(v * 1.2)} over 3s, stacks 5 times` },
};
export const ELEMENTS = {
  fire: { name: 'Fire', color: 0xff6a1a, css: '#ff7a2a', icon: '🔥' },
  frost: { name: 'Frost', color: 0x8ad8ff, css: '#9ae0ff', icon: '❄' },
  shock: { name: 'Lightning', color: 0xb48aff, css: '#c09aff', icon: '⚡' },
  poison: { name: 'Poison', color: 0x6aff3a, css: '#7aff5a', icon: '☠' },
};
// Each bonus has a color, so an item glows the color of its strongest property.
const MOD_COLOR = {
  str: 0xe0402a, dex: 0x3ad070, vit: 0xe8a030, spi: 0x4a80ff, life: 0xff3a5a, mana: 0x3aa0ff, dmgPct: 0xff6a20,
  armor: 0xc8d0dc, lifeSteal: 0xb01030, atkSpd: 0xffe050, moveSpd: 0x80f0ff, crit: 0xff5ad0, regen: 0x5aff8a,
  gold: 0xffd040, block: 0xd8d8e8, thorns: 0x8ab040,
};
/** The look an item's bonuses give it: { col, el } (both may be null). */
export function itemAura(it) {
  if (!it || !it.mods) return { col: null, el: null };
  const el = Object.keys(ELEMENTS).find((k) => it.mods[k]) || null;
  if (el) return { col: ELEMENTS[el].color, el };
  const first = Object.keys(it.mods).find((k) => MOD_COLOR[k] != null);
  return { col: first ? MOD_COLOR[first] : null, el: null };
}
// Everything the renderer needs to draw an item uniquely: shape family (kind/tier), rarity,
// a stable seed from the item id (picks blade shape, guard, pommel, heraldry, metal…) and the
// colors of its two strongest bonuses (enamel, gems, runes, cloth).
export function itemSeed(it) {
  const str = String(it?.id ?? `${it?.base}${it?.ilvl}${it?.name}`);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function itemLook(it) {
  if (!it) return null;
  const { col, el } = itemAura(it);
  const keys = Object.keys(it.mods || {}).filter((k) => MOD_COLOR[k] != null);
  const second = el ? keys[0] : keys[1];
  return { kind: it.kind, tier: it.tier ?? 0, rarity: it.rarity || 'common', col, el, col2: second ? MOD_COLOR[second] : null, s: itemSeed(it) };
}
const RARE_A = ['Grim', 'Storm', 'Blood', 'Ash', 'Iron', 'Raven', 'Dread', 'Ember', 'Bone', 'Gloom', 'Wolf', 'Doom', 'Night', 'Rune'];
const RARE_B = { weapon: ['Fang', 'Bite', 'Edge', 'Song', 'Cleaver', 'Reaper'], offhand: ['Ward', 'Wall', 'Guard', 'Bastion'], head: ['Visage', 'Crown', 'Cowl', 'Brow'], chest: ['Shell', 'Hide', 'Carapace', 'Mantle'], hands: ['Grasp', 'Hold', 'Claws', 'Fists'], feet: ['Stride', 'March', 'Track', 'Tread'], ring: ['Loop', 'Coil', 'Band', 'Spiral'], amulet: ['Heart', 'Eye', 'Charm', 'Star'] };

let idCounter = 0;
export function newItemId(rng) {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor((rng ? rng.next() : Math.random()) * 1e6).toString(36)}`;
}

// Each step up in rarity is much rarer than the one below it.
//   bias 0 = normal monster / barrel, 1 = champion or chest, 2 = boss
//   normal: 72% common · 24% magic · 3.5% rare · 0.25% legendary
//   champion/chest: 55 · 36 · 8 · 0.8      boss: 30 · 48 · 19 · 3
export const RARITY_WEIGHTS = [
  { common: 72, magic: 24, rare: 3.5, legendary: 0.25 },
  { common: 55, magic: 36, rare: 8, legendary: 0.8 },
  { common: 30, magic: 48, rare: 19, legendary: 3 },
];
export function rollRarity(rng, bias = 0) {
  const w = RARITY_WEIGHTS[Math.max(0, Math.min(2, bias))];
  return rng.weighted(Object.entries(w));
}

export function makeItem(rng, baseKey, ilvl, rarity = 'common') {
  const b = BASES[baseKey];
  const tier = tierOf(ilvl);
  const it = { id: newItemId(rng), base: baseKey, slot: b.slot, kind: b.kind, ilvl, rarity, tier, mods: {} };
  if (b.slot === 'weapon') {
    const avg = (4 + ilvl * 1.7) * b.dmg * rng.float(0.9, 1.1);
    it.dmg = [Math.max(1, round(avg * 0.75)), Math.max(2, round(avg * 1.25))];
    it.speed = b.speed;
  }
  if (b.armor) it.armor = Math.max(1, round((3 + ilvl * 1.3) * b.armor * rng.float(0.85, 1.15)));
  if (b.block) it.block = round(b.block[0] + (b.block[1] - b.block[0]) * (tier / 5));
  const nMods = rarity === 'common' ? 0 : rarity === 'magic' ? rng.int(1, 2) : rarity === 'rare' ? rng.int(3, 4) : 5;
  const pool = Object.keys(MODS).filter((k) => !MODS[k].elem && (!MODS[k].only || MODS[k].only.includes(b.slot)) && (!MODS[k].not || !MODS[k].not.includes(b.slot)));
  rng.shuffle(pool);
  for (const k of pool.slice(0, nMods)) {
    let v = MODS[k].roll(rng, ilvl);
    if (rarity === 'legendary') v = typeof v === 'number' && !Number.isInteger(v) ? +(v * 1.5).toFixed(1) : round(v * 1.5);
    it.mods[k] = v;
  }
  // Weapons may carry an element on top of their other bonuses.
  let element = null;
  if (b.slot === 'weapon' && rng.chance({ common: 0, magic: 0.4, rare: 0.75, legendary: 1 }[rarity])) {
    element = rng.pick(Object.keys(ELEMENTS));
    let v = MODS[element].roll(rng, ilvl);
    if (rarity === 'legendary') v = round(v * 1.5);
    it.mods[element] = v;
  }
  if (rarity === 'legendary' && it.dmg) it.dmg = it.dmg.map((d) => round(d * 1.25));
  if (rarity === 'legendary' && it.armor) it.armor = round(it.armor * 1.3);
  // Name
  const base = b.names[tier];
  const keys = Object.keys(it.mods).filter((k) => k !== element);
  if (rarity === 'magic') {
    const pre = element ? MODS[element].pre : keys[0] ? MODS[keys[0]].pre : '';
    const suf = element ? (keys[0] ? MODS[keys[0]].suf : '') : keys[1] ? MODS[keys[1]].suf : '';
    it.name = [pre, base, suf].filter(Boolean).join(' ');
  } else if (rarity === 'rare' || rarity === 'legendary') {
    it.name = `${rng.pick(RARE_A)} ${rng.pick(RARE_B[b.slot])}`;
    it.baseName = base;
  } else {
    it.name = base;
  }
  it.req = Math.max(1, Math.floor(ilvl * 0.85));
  const rm = { common: 1, magic: 2.2, rare: 5, legendary: 12 }[rarity];
  it.value = round((8 + Math.pow(ilvl, 1.35) * 4) * rm);
  return it;
}

export function randomItem(rng, ilvl, bias = 0, slotFilter = null) {
  const keys = Object.keys(BASES).filter((k) => !slotFilter || slotFilter.includes(BASES[k].slot));
  const baseKey = rng.weighted(keys.map((k) => [k, BASES[k].drop ?? (BASES[k].slot === 'weapon' ? 1.3 : BASES[k].slot === 'ring' || BASES[k].slot === 'amulet' ? 0.6 : 1)]));
  return makeItem(rng, baseKey, ilvl, rollRarity(rng, bias));
}

export function isTwoHanded(it) { return !!it && !!BASES[it.base]?.twoHanded; }

export function itemLines(it) {
  const out = [];
  if (it.dmg) out.push(`${it.dmg[0]}–${it.dmg[1]} Damage`, `${(1 / it.speed).toFixed(2)} Attacks per second`);
  if (isTwoHanded(it)) out.push('Two-handed (no shield)');
  if (it.armor) out.push(`${it.armor} Armor`);
  if (it.block) out.push(`${it.block}% Block Chance`);
  for (const [k, v] of Object.entries(it.mods || {})) if (MODS[k]) out.push(MODS[k].fmt(v));
  return out;
}

// ---------------------------------------------------------------- characters
export function newCharacter(name, cls = 'knight') {
  const c = CLASSES[cls];
  const rng = new RNG(Date.now() ^ (Math.random() * 1e9));
  const equip = {};
  for (const [slot, base] of Object.entries(c.starter)) equip[slot] = makeItem(rng, base, 1, 'common');
  equip.weapon.name = c.starterName; equip.weapon.dmg = isTwoHanded(equip.weapon) ? [4, 8] : [3, 6];
  return {
    v: 1,
    name, cls, level: 1, xp: 0, gold: 50,
    stats: { ...c.base }, statPts: 0,
    skills: Object.fromEntries(c.skills.map((id, i) => [id, i === 0 ? 1 : 0])), skillPts: 0,
    equip, inv: new Array(INV_SIZE).fill(null),
    potions: { hp: 4, mp: 2 },
    mats: {},
    maxFloor: 1, kills: 0, deaths: 0, playTime: 0,
  };
}

export function validName(n) {
  return typeof n === 'string' && /^[A-Za-z][A-Za-z0-9 '-]{1,15}$/.test(n.trim());
}

export function derive(ch, buffs = null) {
  const s = { ...ch.stats };
  const m = { life: 0, mana: 0, dmgPct: 0, armor: 0, lifeSteal: 0, atkSpd: 0, moveSpd: 0, crit: 0, regen: 0, gold: 0, block: 0, thorns: 0, fire: 0, frost: 0, shock: 0, poison: 0 };
  let armor = 0; let block = 0;
  let weapon = null;
  for (const slot of SLOTS) {
    const it = ch.equip?.[slot];
    if (!it) continue;
    if (slot === 'weapon') weapon = it;
    armor += it.armor || 0;
    block += it.block || 0;
    for (const [k, v] of Object.entries(it.mods || {})) {
      if (k in s) s[k] += v; else if (k in m) m[k] += v;
    }
  }
  const L = ch.level;
  const d = {};
  d.str = s.str; d.dex = s.dex; d.vit = s.vit; d.spi = s.spi;
  d.hpMax = round(50 + s.vit * 3 + L * 6 + m.life);
  d.mpMax = round(20 + s.spi * 3 + L * 2 + m.mana);
  d.hpRegen = +(0.3 + L * 0.05 + m.regen).toFixed(1);
  d.mpRegen = +(1.2 + s.spi * 0.06).toFixed(2);
  const wd = weapon?.dmg || [2, 4];
  const power = CLASSES[ch.cls]?.power || 'str';
  let mult = 1 + s[power] * 0.015 + m.dmgPct / 100;
  if (buffs?.warcry) mult += buffs.warcry.dmg;
  if (buffs?.bloodlust) { m.atkSpd += buffs.bloodlust.atkSpd; m.lifeSteal += buffs.bloodlust.lifeSteal; }
  d.dmg = [Math.max(1, round(wd[0] * mult)), Math.max(2, round(wd[1] * mult))];
  d.atkInterval = +((weapon?.speed || 0.55) / (1 + m.atkSpd / 100)).toFixed(3);
  d.reach = weapon ? BASES[weapon.base]?.reach || 2.3 : 2.0;
  d.armor = round(armor + m.armor + s.dex * 0.5 + (buffs?.warcry ? buffs.warcry.armor : 0));
  d.crit = +(5 + s.dex * 0.15 + m.crit).toFixed(1);
  d.block = clamp(block + m.block, 0, 50);
  d.lifeSteal = m.lifeSteal;
  d.moveSpeed = +(5.4 * (1 + m.moveSpd / 100)).toFixed(2);
  d.goldFind = m.gold;
  d.stunChance = weapon ? BASES[weapon.base]?.stunChance || 0 : 0;
  d.weaponKind = weapon?.kind || 'none';
  d.thorns = m.thorns;
  d.elem = { fire: m.fire, frost: m.frost, shock: m.shock, poison: m.poison };
  return d;
}

// ---------------------------------------------------------------- level sync
// On a dungeon floor, anyone more than SYNC.margin levels above its monsters fights at that cap:
// base stats are recomputed for the cap, spent attribute points shrink in proportion, and gear
// above the cap is scaled to what a cap-level item would roll. Skills and skill ranks are kept.
// Synced heroes earn SYNC.xpBonus extra XP, so helping lower-level friends pays.
export const SYNC = { margin: 2, xpBonus: 0.15 };

// Buffs and debuffs shown with a countdown (on your HUD, and on a monster's health bar).
export const STATUS = {
  warcry: { name: 'War Cry', icon: '📯', good: true, desc: 'More damage and armor.' },
  bloodlust: { name: 'Bloodlust', icon: '🩸', good: true, desc: 'Faster attacks and life steal.' },
  ward: { name: 'Arcane Ward', icon: '🔮', good: true, desc: 'Absorbs damage.' },
  rejuv: { name: 'Rejuvenation', icon: '✚', good: true, desc: 'Healing over time.' },
  wolf: { name: 'Spirit Wolf', icon: '🐺', good: true, desc: 'Your wolf fights beside you.' },
  poison: { name: 'Poisoned', icon: '☠', desc: 'Taking poison damage. Stacks.' },
  burn: { name: 'Burning', icon: '🔥', desc: 'Taking fire damage.' },
  slow: { name: 'Slowed', icon: '🐌', desc: 'Moving slower.' },
  chill: { name: 'Chilled', icon: '❄', desc: 'Frozen and slowed.' },
  stun: { name: 'Stunned', icon: '💫', desc: "Can't act." },
};
// Debuffs monsters put on you: spiders poison, imps set you alight, boss slams daze.
export const MONSTER_DEBUFF = {
  spider: { poison: { dur: 4, per: 0.12, max: 3 } },
  spiderling: { poison: { dur: 3, per: 0.1, max: 3 } },
  broodmother: { poison: { dur: 5, per: 0.08, max: 3 } },
  imp: { burn: { dur: 3, per: 0.22 } },
};
// Bank: shared by every hero on an account. Extra tabs are bought with gold.
export const BANK = { tabSize: 30, maxTabs: 4, tabCost: [0, 2500, 10000, 40000], maxGold: 1e9 };
// Mail: letters between heroes, with up to 6 items and some gold attached.
export const MAIL = { maxItems: 6, postage: 10, perItem: 10, subjectMax: 40, bodyMax: 500, keepDays: 30, inboxMax: 60, maxGold: 1e9 };
export function postage(nItems) { return MAIL.postage + MAIL.perItem * nItems; }
export const SLAM_DAZE = 2.5; // seconds slowed after a boss slam lands on you
export const SLOW_MULT = 0.6;
export function syncCapFor(floor) { return floor > 0 ? Math.max(1, Math.round(floor * 1.5)) + SYNC.margin : 0; }
function scaleItem(it, cap) {
  const il = it.ilvl || 1;
  if (il <= cap) return it;
  const rD = (4 + cap * 1.7) / (4 + il * 1.7);
  const rA = (3 + cap * 1.3) / (3 + il * 1.3);
  const sc = (v, r) => (typeof v !== 'number' ? v : Number.isInteger(v) ? Math.max(1, round(v * r)) : +(v * r).toFixed(1));
  const out = { ...it, ilvl: cap, mods: {} };
  if (it.dmg) out.dmg = [Math.max(1, round(it.dmg[0] * rD)), Math.max(2, round(it.dmg[1] * rD))];
  if (it.armor) out.armor = Math.max(1, round(it.armor * rA));
  for (const [k, v] of Object.entries(it.mods || {})) out.mods[k] = sc(v, rD);
  return out;
}
/** The character as it fights under a level cap, or null if it isn't above the cap. */
export function syncedChar(ch, cap) {
  if (!cap || ch.level <= cap) return null;
  const C = CLASSES[ch.cls];
  const k = (cap - 1) / Math.max(1, ch.level - 1);
  const stats = {};
  for (const s of Object.keys(ch.stats)) {
    const natural = (C.base[s] || 0) + (C.grow[s] || 0) * (ch.level - 1);
    const spent = Math.max(0, ch.stats[s] - natural);
    stats[s] = (C.base[s] || 0) + (C.grow[s] || 0) * (cap - 1) + round(spent * k);
  }
  const equip = {};
  for (const [slot, it] of Object.entries(ch.equip || {})) equip[slot] = it ? scaleItem(it, cap) : it;
  return { ...ch, level: cap, stats, equip };
}

export function canEquip(ch, it) {
  if (!it) return 'Nothing there';
  if (ch.level < (it.req || 1)) return `Requires level ${it.req}`;
  if (classBlocks(ch.cls, it)) return `${CLASSES[ch.cls].name}s can't use shields`;
  return null;
}

// Gear a class can never wear (the Berserker takes no shield).
export function classBlocks(cls, it) {
  return !!(it && it.slot === 'offhand' && CLASSES[cls]?.noShield);
}

// Damage reduction from armor against a monster of a given level.
export function armorReduction(armor, monsterLevel) { return armor / (armor + 40 + 9 * monsterLevel); }

export function potionPrice(kind, level) { return round((kind === 'hp' ? 20 : 25) * (1 + level * 0.12)); }

// ---------------------------------------------------------------- monsters
export const MONSTERS = {
  skeleton: { name: 'Skeleton', hp: 30, dmg: 4, speed: 2.8, range: 1.7, cd: 1.5, windup: 0.45, xp: 12, r: 0.45, arc: 90, aggro: 13 },
  rat: { name: 'Plague Rat', hp: 12, dmg: 2, speed: 4.4, range: 1.2, cd: 0.9, windup: 0.25, xp: 5, r: 0.35, arc: 90, aggro: 11 },
  archer: { name: 'Skeleton Archer', hp: 20, dmg: 6, speed: 2.6, range: 10, cd: 2.0, windup: 0.6, xp: 14, r: 0.45, ranged: { speed: 14, keep: 6, kind: 'arrow' }, aggro: 14 },
  spider: { name: 'Cave Spider', hp: 22, dmg: 5, speed: 4.8, range: 1.5, cd: 1.1, windup: 0.3, xp: 11, r: 0.55, arc: 90, aggro: 12 },
  goblin: { name: 'Goblin Cutter', hp: 18, dmg: 4, speed: 4.1, range: 1.4, cd: 1.0, windup: 0.3, xp: 9, r: 0.4, arc: 90, aggro: 12 },
  imp: { name: 'Fire Imp', hp: 20, dmg: 5, speed: 3.9, range: 8, cd: 2.4, windup: 0.5, xp: 12, r: 0.4, ranged: { speed: 10, keep: 5, kind: 'fireball' }, aggro: 13 },
  spiderling: { name: 'Spiderling', hp: 8, dmg: 2, speed: 5.2, range: 1.1, cd: 0.9, windup: 0.2, xp: 2, r: 0.3, arc: 90, aggro: 30 },
  ogre: { name: 'Gravemaw the Ogre', hp: 700, dmg: 16, speed: 2.4, range: 3.0, cd: 2.0, windup: 0.8, xp: 450, r: 1.2, arc: 120, aggro: 16, boss: true, slam: { radius: 4.5, every: 8, tell: 1.3, mult: 1.6 }, summon: 'skeleton' },
  broodmother: { name: 'The Broodmother', hp: 600, dmg: 13, speed: 3.0, range: 2.6, cd: 1.6, windup: 0.6, xp: 450, r: 1.3, arc: 120, aggro: 16, boss: true, slam: { radius: 4, every: 9, tell: 1.1, mult: 1.3 }, summon: 'spiderling' },
};

export function monsterStats(type, floor, { elite = false, partySize = 1 } = {}) {
  const d = MONSTERS[type];
  const f = floor - 1;
  const hpMul = 1.2 * (1 + 0.36 * f + 0.014 * f * f) * (elite ? 3.2 : 1) * (1 + 0.65 * (partySize - 1));
  const dmgMul = Math.min(1.7, 1.1 + 0.04 * f) * (1 + 0.22 * f + 0.004 * f * f) * (elite ? 1.5 : 1);
  return {
    hp: round(d.hp * hpMul),
    dmg: Math.max(1, round(d.dmg * dmgMul)),
    xp: round(d.xp * (1 + 0.28 * f) * (elite ? 4 : 1)),
    level: Math.max(1, Math.round(floor * 1.5)),
    speed: d.speed * (elite ? 1.1 : 1),
  };
}

// ---------------------------------------------------------------- crafting
// Materials stack in the character's material pouch (ch.mats), not the pack.
export const MATERIALS = {
  scrap: { name: 'Iron Scrap', color: '#b8b0a4', icon: '⛓', desc: 'Salvaged from common gear and broken barrels.' },
  dust: { name: 'Arcane Dust', color: '#6aa8ff', icon: '✧', desc: 'Salvaged from magic items.' },
  shard: { name: 'Shadow Shard', color: '#ffd84a', icon: '◆', desc: 'Salvaged from rare items.' },
  core: { name: 'Ember Core', color: '#ff8a2a', icon: '✹', desc: 'Salvaged from legendary items.' },
  sigil: { name: "Guardian's Sigil", color: '#e05aff', icon: '⚜', desc: 'Only dropped by floor guardians (bosses).', boss: true },
  tusk: { name: "Gravemaw's Tusk", color: '#f0e6c8', icon: '🦷', desc: 'Only dropped by Gravemaw the Ogre.', boss: true },
  silk: { name: "Broodmother's Silk", color: '#a8ffb0', icon: '🕸', desc: 'Only dropped by the Broodmother.', boss: true },
};
export const BOSS_TROPHY = { ogre: 'tusk', broodmother: 'silk' };

// What breaking an item down gives you.
export function salvageYield(it, rng) {
  const r = () => (rng ? rng.next() : Math.random());
  const n = (a, b) => a + Math.floor(r() * (b - a + 1));
  const bonus = Math.floor((it.ilvl || 1) / 12); // deeper gear gives a little more
  switch (it.rarity) {
    case 'legendary': return { shard: n(2, 3), core: 1 + bonus };
    case 'rare': return { dust: n(2, 3) + bonus, shard: n(1, 2) };
    case 'magic': return { scrap: n(1, 2), dust: n(1, 2) + bonus };
    default: return { scrap: n(2, 3) + bonus };
  }
}

// Craftable bases (what you pick) and the quality tiers (what it costs and how good it rolls).
export const CRAFT_BASES = ['sword', 'axe', 'mace', 'staff', 'greataxe', 'greatsword', 'maul', 'shield', 'helm', 'chest', 'gloves', 'boots', 'ring', 'amulet'];
export const RECIPES = {
  apprentice: { name: 'Apprentice', rarity: 'magic', ilvlBonus: 0, cost: { scrap: 6, dust: 3 }, gold: (l) => 40 + l * 12, desc: 'A magic item with 1–2 random bonuses.' },
  master: { name: 'Master', rarity: 'rare', ilvlBonus: 2, cost: { scrap: 10, dust: 6, shard: 3 }, gold: (l) => 150 + l * 30, desc: 'A rare item with 3–4 random bonuses.' },
  mythic: { name: 'Guardian-forged', rarity: 'legendary', ilvlBonus: 3, cost: { shard: 4, core: 2, sigil: 1 }, trophy: 1, gold: (l) => 500 + l * 60, desc: 'A legendary item with 5 strong random bonuses. Needs a boss trophy (tusk or silk).' },
};

// ------------------------------------------------------------ auction house
export const AUCTION = {
  cut: 0.05,          // the broker keeps 5% of each sale
  maxListings: 10,    // active listings per hero
  pageSize: 20,
  maxPrice: 9999999,
  // A starting price to suggest when listing: a few times what a vendor would pay.
  suggest: (it) => Math.max(10, Math.round(it.value * ({ common: 2, magic: 3, rare: 5, legendary: 8 }[it.rarity] || 3) / 10) * 10),
};
