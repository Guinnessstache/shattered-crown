// The forge: builds every player weapon and shield from parts, so no two items look alike.
//
//   shape family  ← kind + tier   (Short Sword … Kingsfall, Buckler … Dragonguard)
//   part choices  ← item seed     (blade outline, tip, fuller, guard, grip wrap, pommel, metal,
//                                  heraldry, charms…)
//   colors        ← item stats    (gems, runes, enamel and heraldry take the colors of the
//                                  item's strongest bonuses; elements tint the glow)
//   flair         ← rarity        (magic: a gem · rare: glowing runes · legendary: a glowing
//                                  edge, gilded fittings and a floating rune ring)
//
// Every weapon is built with its grip centred on the origin and the business end along +Y,
// exactly like the old models, so hands, animations and loot drops line up unchanged.
import * as THREE from 'three';
import { common, flat, glow } from './materials.js';

// ---------------------------------------------------------------- seeded random
function rngOf(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, f: (a, b) => a + (b - a) * next(), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
}

// ---------------------------------------------------------------- materials
const RARITY_GEM = { common: null, magic: 0x4a8aff, rare: 0xffc030, legendary: 0xff6a18 };
const RUNE_DEFAULT = [0x9ad0ff, 0x9ad0ff, 0x9ad0ff, 0x8ab8ff, 0xff4a3a, 0xffa040];
// Blade / head metals: [color, metalness, roughness]
const METALS = {
  iron: [0x7a7e84, 0.8, 0.45], steel: [0xa8acb4, 0.88, 0.32], bright: [0xb4b8c0, 0.92, 0.28], blued: [0x6a7ea6, 0.88, 0.3],
  dark: [0x44444c, 0.85, 0.34], black: [0x26242a, 0.8, 0.32], bronze: [0xb07a3e, 0.9, 0.34], gilded: [0xd8aa50, 0.92, 0.28],
  ember: [0x5a3a34, 0.8, 0.34], silver: [0xc4c8d0, 0.92, 0.26],
};
const TIER_METALS = [['iron', 'bronze', 'iron'], ['steel', 'iron', 'bronze'], ['steel', 'bright', 'blued'], ['bright', 'blued', 'silver'], ['dark', 'black', 'dark'], ['gilded', 'ember', 'bright']];
const FITTINGS = { common: ['iron', 'bronze'], magic: ['steel', 'bronze', 'silver'], rare: ['gilded', 'silver', 'bronze'], legendary: ['gilded'] };
const GRIP_COLORS = [0x5a3420, 0x3a2418, 0x241a14, 0x6a1a18, 0x1a2a4a, 0x2a3a24, 0x4a3a2a];

const metalMat = (name, tint = null) => {
  const [c, m, r] = METALS[name] || METALS.steel;
  return common('steel', { color: tint ?? c, metal: m, rough: r });
};
function gemMat(col) { return flat(col, { emissive: col, emissiveIntensity: 1.4, rough: 0.08, metal: 0.3 }); }
const runeMats = new Map();
function runeMat(col) {
  if (!runeMats.has(col)) {
    const c = new THREE.Color(col).multiplyScalar(2.2);
    runeMats.set(col, new THREE.MeshBasicMaterial({ map: runeAtlas(), color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
  }
  return runeMats.get(col);
}
function edgeGlowMat(col) {
  const c = new THREE.Color(col).multiplyScalar(1.8);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
}

// 16 angular rune glyphs in a 4×4 atlas.
let atlas = null;
function runeAtlas() {
  if (atlas) return atlas;
  const N = 64; const c = document.createElement('canvas'); c.width = c.height = N * 4;
  const g = c.getContext('2d');
  let s = 99; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 6;
  for (let i = 0; i < 16; i++) {
    const ox = (i % 4) * N; const oy = Math.floor(i / 4) * N;
    g.lineWidth = 5; g.beginPath();
    const pts = [[0.5, 0.12], [0.5, 0.88]];
    g.moveTo(ox + N * 0.5, oy + N * 0.12); g.lineTo(ox + N * 0.5, oy + N * 0.88);
    for (let k = 0; k < 2 + (i % 3); k++) {
      const y0 = 0.2 + r() * 0.6; const dir = r() < 0.5 ? -1 : 1;
      g.moveTo(ox + N * 0.5, oy + N * y0); g.lineTo(ox + N * (0.5 + dir * (0.22 + r() * 0.12)), oy + N * (y0 + (r() - 0.5) * 0.4));
    }
    if (i % 4 === 1) { g.moveTo(ox + N * 0.3, oy + N * 0.3); g.lineTo(ox + N * 0.7, oy + N * 0.3); }
    g.stroke(); void pts;
  }
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace;
  return atlas;
}
function runeQuad(i, size) {
  const q = new THREE.PlaneGeometry(size * 0.7, size);
  const u0 = (i % 4) / 4; const v1 = 1 - Math.floor(i / 4) / 4;
  const uv = q.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.25, v1 - 0.25 + uv.getY(k) * 0.25);
  return q;
}

// ---------------------------------------------------------------- geometry helpers
const V2 = (x, y) => new THREE.Vector2(x, y);
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(Math.max(0.0001, r), y)), seg);
function rbox(w, h, d, r = 0.01) {
  const s = new THREE.Shape(); const hw = w / 2 - r; const hh = h / 2 - r;
  s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.lineTo(-hw, -hh);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - r * 2), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - r * 2) / 2); g.computeVertexNormals();
  return scaleUV(g, 6);
}
// Extrusions get UVs in metres; stretch them so metal grain stays fine instead of blotchy.
function scaleUV(g, k) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); return g; }
function extrude(pts, depth, bevel = 0.006, segs = 1) {
  const s = new THREE.Shape(pts.map(([x, y]) => V2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return scaleUV(g, 6);
}
function tube(points, r, seg = 24, rad = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))), seg, r, rad, false);
}
// Tapered sweep along a curve: radius(t) per ring, with optional lumpy noise (gnarled wood).
function sweep(points, radius, { seg = 40, rad = 8, lumpy = 0, seed = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = []; const uv = []; const idx = [];
  const rn = rngOf(seed); const bumps = Array.from({ length: 8 }, () => [rn.f(0, 1), rn.f(0, 6.28), rn.f(0.5, 1.5)]);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; const p = curve.getPointAt(t); const N = frames.normals[i]; const B = frames.binormals[i];
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      let r = radius(t);
      if (lumpy) for (const [bt, ba, bw] of bumps) r *= 1 + lumpy * Math.exp(-((t - bt) ** 2) * 900) * (0.6 + 0.4 * Math.cos(a - ba)) * bw;
      pos.push(p.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), p.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), p.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
      uv.push(j / rad, t * 4);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j; const b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// A blade with a real cross-section: sharpened edge bevels, optional fuller groove, and an
// outline driven by width functions so it can taper, curve, wave or be serrated.
//   wl(t), wr(t): half-widths to the left/right edge;  cx(t): centre-line offset;  th(t): thickness
function bladeGeo({ len, base = 0, N = 28, wl, wr, cx = () => 0, th, fuller = null, edge = 0.014 }) {
  const ring = 12; const pos = []; const uvs = [];
  const maxW = 0.12;
  for (let i = 0; i <= N; i++) {
    const t = i / N; const y = base + t * len;
    const L = Math.max(0.0005, wl(t)); const R = Math.max(0.0005, wr(t)); const c = cx(t); const T = th(t);
    const eL = Math.min(edge, L * 0.6); const eR = Math.min(edge, R * 0.6);
    const inF = fuller && t > fuller.from && t < fuller.to;
    const fw = inF ? Math.min(fuller.w, Math.min(L, R) * 0.45) : 0.0004; const fd = inF ? T * fuller.depth : 0;
    const tb = T * 0.38;
    const P = [
      [c - L, 0], [c - L + eL, tb], [c - fw * 1.6, T], [c - fw, T - fd * 0.6], [c, T - fd], [c + fw, T - fd * 0.6], [c + fw * 1.6, T], [c + R - eR, tb],
      [c + R, 0], [c + R - eR, -tb], [c, -T + fd], [c - L + eL, -tb],
    ];
    for (const [x, z] of P) { pos.push(x, y, z); uvs.push(x / maxW + 0.5, y); }
  }
  const idx = [];
  for (let i = 0; i < N; i++) for (let k = 0; k < ring; k++) {
    const a = i * ring + k; const b = i * ring + ((k + 1) % ring); const c2 = a + ring; const d = b + ring;
    idx.push(a, c2, b, b, c2, d);
  }
  // cap the base
  for (let k = 1; k < ring - 1; k++) idx.push(0, k + 1, k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  const flatG = g.toNonIndexed(); flatG.computeVertexNormals();
  return flatG;
}

// ---------------------------------------------------------------- shared parts
function gripPart(g, rn, { len = 0.22, r = 0.028, col, fitting }) {
  const leather = common('leather', { color: col, rough: 0.85 });
  g.add(mesh(lathe([[r * 0.9, -len / 2], [r * 1.08, -len * 0.15], [r * 1.08, len * 0.15], [r * 0.9, len / 2]], 12), leather));
  // spiral leather wrap
  const pts = []; const turns = 5 + Math.floor(rn.f(0, 3));
  for (let i = 0; i <= 60; i++) { const t = i / 60; const a = t * turns * Math.PI * 2; pts.push([Math.cos(a) * r * 1.07, -len / 2 + t * len, Math.sin(a) * r * 1.07]); }
  g.add(mesh(tube(pts, r * 0.22, 120, 4), common('leather', { color: new THREE.Color(col).multiplyScalar(0.6).getHex(), rough: 0.9 })));
  for (const y of [-len / 2, len / 2]) g.add(mesh(lathe([[r * 1.1, y - 0.012], [r * 1.25, y], [r * 1.1, y + 0.012]], 12), fitting));
}

function pommelPart(g, rn, style, y, fitting, gem) {
  switch (style) {
    case 'disc': g.add(mesh(lathe([[0.012, y + 0.02], [0.05, y + 0.012], [0.055, y - 0.01], [0.04, y - 0.03], [0.001, y - 0.035]], 14), fitting)); break;
    case 'wheel': { const w = mesh(new THREE.TorusGeometry(0.042, 0.016, 8, 18), fitting, 0, y - 0.03, 0); g.add(w); g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.022, 14), fitting, 0, y - 0.03, 0).rotateX(Math.PI / 2)); break; }
    case 'gem': {
      g.add(mesh(lathe([[0.02, y + 0.01], [0.04, y - 0.01], [0.035, y - 0.03]], 12), fitting));
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const p = mesh(new THREE.ConeGeometry(0.008, 0.05, 4), fitting, Math.cos(a) * 0.03, y - 0.05, Math.sin(a) * 0.03); p.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); g.add(p); }
      const s = mesh(new THREE.OctahedronGeometry(0.035), gem || metalMat('silver'), 0, y - 0.065, 0); s.scale.y = 1.4; g.add(s);
      break;
    }
    case 'crescent': { const c = mesh(extrude([[-0.05, 0], [-0.03, -0.04], [0, -0.055], [0.03, -0.04], [0.05, 0], [0.025, -0.02], [0, -0.028], [-0.025, -0.02]], 0.022, 0.004), fitting, 0, y - 0.005, 0); g.add(c); break; }
    case 'skull': {
      const bone = common('bone', { rough: 0.6 });
      const sk = mesh(new THREE.SphereGeometry(0.04, 12, 10), bone, 0, y - 0.04, 0); sk.scale.set(1, 1.1, 0.95); g.add(sk);
      for (const x of [-0.014, 0.014]) g.add(mesh(new THREE.SphereGeometry(0.009, 6, 4), gem || flat(0x0a0606), x, y - 0.04, 0.035));
      break;
    }
    default: { const b = mesh(new THREE.SphereGeometry(0.042, 14, 10), fitting, 0, y - 0.035, 0); b.scale.y = 0.85; g.add(b); }
  }
}

// Cross-guards. All sit centred at y with the blade rising from y + 0.02.
function guardPart(g, rn, style, y, span, fitting, gem) {
  switch (style) {
    case 'curved': case 'upswept': {
      const dir = style === 'curved' ? -1 : 1;
      g.add(mesh(rbox(0.08, 0.05, 0.05, 0.012), fitting, 0, y, 0));
      for (const s of [-1, 1]) {
        g.add(mesh(tube([[0, y, 0], [s * span * 0.3, y + dir * 0.005, 0], [s * span * 0.55, y + dir * 0.03, 0], [s * span * 0.62, y + dir * 0.07, 0]], 0.014, 16, 7), fitting));
        g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), fitting, s * span * 0.62, y + dir * 0.075, 0));
      }
      break;
    }
    case 'winged': {
      for (const s of [-1, 1]) {
        const w = mesh(extrude([[0, -0.02], [0.08, -0.03], [0.17, 0.02], [0.2, 0.09], [0.13, 0.05], [0.12, 0.08], [0.06, 0.03], [0, 0.03]], 0.026, 0.006), fitting, 0, y, 0);
        w.scale.x = s * span / 0.4; g.add(w);
      }
      g.add(mesh(rbox(0.08, 0.07, 0.06, 0.014), fitting, 0, y, 0));
      break;
    }
    case 'ring': {
      g.add(mesh(rbox(span, 0.04, 0.045, 0.012), fitting, 0, y, 0));
      const r = mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), fitting, span * 0.28, y - 0.06, 0); g.add(r);
      break;
    }
    case 'spiked': {
      g.add(mesh(rbox(span * 0.8, 0.05, 0.05, 0.01), fitting, 0, y, 0));
      for (const s of [-1, 1]) {
        const sp = mesh(new THREE.ConeGeometry(0.022, 0.14, 5), fitting, s * span * 0.46, y + 0.02, 0); sp.rotation.z = -s * 1.1; g.add(sp);
        const sp2 = mesh(new THREE.ConeGeometry(0.014, 0.07, 5), fitting, s * span * 0.26, y - 0.035, 0); sp2.rotation.z = Math.PI + s * 0.5; g.add(sp2);
      }
      break;
    }
    default: { // 'bar' with flared ends
      g.add(mesh(rbox(span, 0.042, 0.05, 0.012), fitting, 0, y, 0));
      for (const s of [-1, 1]) g.add(mesh(rbox(0.04, 0.07, 0.055, 0.012), fitting, s * span * 0.5, y, 0));
    }
  }
  if (gem) { const gm = mesh(new THREE.OctahedronGeometry(0.024), gem, 0, y, 0.03); gm.scale.set(1, 1.3, 0.6); g.add(gm); const gb = gm.clone(); gb.position.z = -0.03; g.add(gb); }
}

function runeRow(g, rn, { from, to, x = 0, z, size = 0.04, col, flip = false }) {
  const mat = runeMat(col);
  for (let y = from; y < to; y += size * 1.25) {
    const q = mesh(runeQuad(Math.floor(rn.f(0, 16)), size), mat, x, y, z);
    if (flip) q.rotation.y = Math.PI;
    q.castShadow = false; g.add(q);
  }
}

// A slowly turning ring of runes around the weapon (legendaries).
function runeHalo(g, y, r, col) {
  const ring = new THREE.Group(); ring.position.y = y;
  const mat = runeMat(col); const rn = rngOf(Math.floor(r * 1000));
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    const q = new THREE.Mesh(runeQuad(Math.floor(rn.f(0, 16)), 0.06), mat);
    q.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); q.rotation.y = -a + Math.PI / 2; q.castShadow = false;
    ring.add(q);
  }
  ring.userData.spin = 0.9;
  g.add(ring); g.userData.spinners = (g.userData.spinners || []).concat(ring);
}

// ---------------------------------------------------------------- swords
// Tier families: Short Sword · Broadsword · Knight's Blade · Runed Longsword · Dread Blade · Kingsfall
function sword(g, L, rn) {
  const t = L.tier;
  const len = [0.62, 0.8, 0.95, 1.02, 1.06, 1.12][t] * rn.f(0.94, 1.06);
  const w = [0.042, 0.056, 0.046, 0.044, 0.05, 0.05][t] * rn.f(0.88, 1.12);
  const th = 0.011;
  const tip = rn.pick(t === 0 ? ['point', 'round', 'clip'] : t === 4 ? ['hook', 'point', 'clip'] : ['point', 'spear', 'point', 'clip']);
  const taper = (u) => {
    const end = tip === 'spear' ? 0.82 : 0.86;
    if (u < end) return 1 - u * (t === 2 || t === 3 ? 0.32 : 0.18);
    const k = (u - end) / (1 - end);
    return (1 - end * 0.25) * (tip === 'round' ? Math.sqrt(Math.max(0, 1 - k * k)) : tip === 'spear' ? (k < 0.25 ? 1 + k * 0.6 : (1 - k) * 1.53) : 1 - k);
  };
  let wl = (u) => w * taper(u); let wr = (u) => w * taper(u); let cx = () => 0;
  if (tip === 'clip') wr = (u) => (u > 0.78 ? w * Math.max(0, (1 - (u - 0.78) / 0.22) * 0.75) : w * taper(u));
  if (tip === 'hook') { wr = (u) => (u > 0.8 ? w * (0.6 + Math.sin((u - 0.8) * 30) * 0.15) * (1 - u) * 5 : w * taper(u)); }
  if (t === 4) { const base = wr; wr = (u) => base(u) * (u > 0.1 && u < 0.7 ? 1 + 0.22 * (((u * 26) % 1) < 0.5 ? (u * 26) % 1 : 1 - (u * 26) % 1) : 1); } // serrated spine
  if (t === 5) { cx = (u) => Math.sin(u * Math.PI * 7) * 0.012 * (1 - u); wl = (u) => w * taper(u) * (1 + 0.12 * Math.sin(u * Math.PI * 14)); wr = (u) => w * taper(u) * (1 - 0.12 * Math.sin(u * Math.PI * 14)); }
  const ricasso = t === 2 || t === 3 ? 0.07 : 0;
  const wlR = ricasso ? (u) => (u * len < ricasso ? w * 0.62 : wl(u)) : wl;
  const wrR = ricasso ? (u) => (u * len < ricasso ? w * 0.62 : wr(u)) : wr;
  const fuller = t >= 1 && (t !== 4 || rn.chance(0.5)) ? { from: 0.06 + ricasso / len, to: rn.f(0.55, 0.75), w: w * 0.28, depth: 0.55 } : null;
  const bladeMetal = rn.pick(TIER_METALS[t]);
  const legendary = L.rarity === 'legendary';
  const bladeMat = metalMat(bladeMetal);
  const y0 = 0.135;
  g.add(mesh(bladeGeo({ len, base: y0, N: t >= 4 ? 64 : 30, wl: wlR, wr: wrR, cx, th: (u) => th * (1 - u * 0.45), fuller }), bladeMat));
  const fitting = metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common));
  const gemC = L.col ?? RARITY_GEM[L.rarity];
  const gem = L.rarity !== 'common' && gemC ? gemMat(gemC) : null;
  const guardStyle = rn.pick([['bar', 'bar', 'curved'], ['bar', 'curved', 'upswept'], ['curved', 'bar', 'ring'], ['curved', 'upswept', 'winged'], ['spiked', 'spiked', 'curved'], ['winged', 'winged', 'upswept']][t]);
  guardPart(g, rn, guardStyle, 0.12, [0.22, 0.28, 0.32, 0.34, 0.34, 0.38][t] * rn.f(0.9, 1.1), fitting, gem);
  const gripLen = (t >= 2 ? 0.26 : 0.2) * rn.f(0.92, 1.08);
  const gg = new THREE.Group(); gg.position.y = 0.1 - gripLen / 2 - 0.0; g.add(gg);
  gripPart(gg, rn, { len: gripLen, col: rn.pick(GRIP_COLORS), fitting });
  pommelPart(g, rn, rn.pick([['ball', 'disc'], ['disc', 'ball', 'wheel'], ['wheel', 'disc', 'gem'], ['gem', 'wheel', 'crescent'], ['skull', 'crescent', 'gem'], ['gem', 'crescent']][t]), 0.1 - gripLen, fitting, gem);
  // runes along the fuller (rare+), glowing edge (legendary)
  const runeCol = L.col ?? RUNE_DEFAULT[t];
  if (fuller && (L.rarity === 'rare' || legendary || t === 3)) {
    for (const z of [th * 0.6, -th * 0.6]) runeRow(g, rn, { from: y0 + len * (fuller.from + 0.04), to: y0 + len * (fuller.to - 0.03), z: z * 0.95, size: Math.min(0.045, w * 0.7), col: runeCol, flip: z < 0 });
  }
  if (legendary) {
    const em = edgeGlowMat(L.col ?? 0xffa040);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const u = 0.04 + (i / 40) * 0.95; pts.push([cx(u) + side * (side < 0 ? wlR(u) : wrR(u)) * 0.97, y0 + u * len, 0]); }
      const e = mesh(tube(pts, 0.0035, 80, 4), em); e.castShadow = false; g.add(e);
    }
    runeHalo(g, y0 + len * 0.35, 0.11, runeCol);
  }
  return y0 + len * 0.62;
}

// ---------------------------------------------------------------- axes
// Hatchet · War Axe · Bearded Axe · Reaver · Doom Axe · Worldsplitter
function axe(g, L, rn) {
  const t = L.tier;
  const haftLen = [0.72, 0.9, 0.98, 1.04, 1.1, 1.16][t];
  const top = haftLen * 0.78;
  const wood = common(t >= 4 ? 'darkwood' : 'wood', { rough: 0.85 });
  g.add(mesh(sweep([[0, -haftLen * 0.22, 0], [0.004, top * 0.3, 0], [-0.004, top * 0.7, 0], [0, top + 0.06, 0]], (u) => 0.03 * (1.05 - u * 0.15), { seg: 24, rad: 9 }), wood));
  const fitting = metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common));
  for (const y of [-haftLen * 0.2, 0.1, top - 0.12]) g.add(mesh(lathe([[0.034, y - 0.018], [0.038, y], [0.034, y + 0.018]], 10), fitting));
  const gg = new THREE.Group(); gg.position.y = -0.04; g.add(gg); gripPart(gg, rn, { len: 0.2, r: 0.032, col: rn.pick(GRIP_COLORS), fitting });
  const headMat = metalMat(rn.pick(TIER_METALS[t]));
  const s = rn.f(0.9, 1.1) * [0.75, 0.9, 1, 1.05, 1.1, 1.25][t];
  const beard = t >= 2 ? rn.f(0.12, 0.22) : rn.f(0.02, 0.08);
  const head = [[0, 0.06], [0.08, 0.05], [0.18, 0.11], [0.22, 0.16], [0.23, 0.05], [0.22, -0.06], [0.16, -0.06 - beard], [0.12, -0.05 - beard * 0.8], [0.08, -0.03], [0, -0.05]].map(([x, y]) => [x * s, y * s]);
  if (t === 3) head.splice(4, 0, [0.25 * s, 0.11 * s]); // reaver hook
  const hg = extrude(head, 0.03, 0.008, 2);
  g.add(mesh(hg, headMat, 0.025, top, 0));
  // edge bevel strip
  const edgeL = [[0.21, 0.15], [0.225, 0.05], [0.215, -0.06]].map(([x, y]) => [x * s + 0.025, top + y * s, 0]);
  if (L.rarity === 'legendary') g.add(mesh(tube(edgeL, 0.006, 12, 4), edgeGlowMat(L.col ?? 0xffa040)));
  if (t >= 4) { // double-bitted
    const h2 = mesh(hg, headMat, -0.025, top, 0); h2.rotation.y = Math.PI; g.add(h2);
  } else if (t >= 3 || rn.chance(0.4)) { // back spike
    const sp = mesh(new THREE.ConeGeometry(0.025, 0.14 * s, 5), headMat, -0.07, top + 0.01, 0); sp.rotation.z = Math.PI / 2; g.add(sp);
  }
  g.add(mesh(rbox(0.07, 0.14, 0.06, 0.01), fitting, 0, top, 0));
  if (t >= 4) { const sp = mesh(new THREE.ConeGeometry(0.02, 0.12, 5), fitting, 0, top + 0.13, 0); g.add(sp); }
  const gemC = L.col ?? RARITY_GEM[L.rarity];
  if (L.rarity !== 'common' && gemC) g.add(mesh(new THREE.OctahedronGeometry(0.022), gemMat(gemC), 0, top, 0.035));
  if (L.rarity === 'rare' || L.rarity === 'legendary' || t >= 3) {
    runeRow(g, rn, { from: top - 0.03, to: top + 0.06, x: 0.12 * s, z: 0.02, size: 0.04, col: L.col ?? RUNE_DEFAULT[t] });
    runeRow(g, rn, { from: top - 0.03, to: top + 0.06, x: 0.12 * s, z: -0.02, size: 0.04, col: L.col ?? RUNE_DEFAULT[t], flip: true });
  }
  if (L.rarity === 'legendary') runeHalo(g, top, 0.2, L.col ?? 0xffa040);
  return top;
}

// ---------------------------------------------------------------- maces
// Club · Flanged Mace · Morningstar · Bonebreaker · Grave Maul · Sunhammer
function mace(g, L, rn) {
  const t = L.tier;
  const shaft = [0.66, 0.74, 0.78, 0.82, 0.9, 0.9][t];
  const fitting = metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common));
  const headMat = metalMat(rn.pick(TIER_METALS[t]));
  const top = shaft * 0.86;
  const gemC = L.col ?? RARITY_GEM[L.rarity];
  if (t === 0) {
    const wood = common('wood', { rough: 0.85 });
    g.add(mesh(lathe([[0.03, -0.14], [0.034, 0.1], [0.06, 0.4], [0.085, 0.62], [0.06, 0.72], [0.001, 0.74]], 12), wood));
    for (const y of [0.42, 0.6]) g.add(mesh(lathe([[0.075, y - 0.02], [0.088, y], [0.075, y + 0.02]], 12), metalMat('iron')));
    for (let i = 0; i < 7; i++) { const a = i * 2.3; const y = 0.46 + (i % 3) * 0.06; const st = mesh(new THREE.ConeGeometry(0.014, 0.05, 5), metalMat('iron'), Math.cos(a) * 0.08, y, Math.sin(a) * 0.08); st.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2); g.add(st); }
    return 0.55;
  }
  g.add(mesh(lathe([[0.024, -0.16], [0.026, top - 0.1], [0.032, top - 0.04]], 10), metalMat(rn.pick(['iron', 'dark']))));
  const gg = new THREE.Group(); gg.position.y = -0.02; g.add(gg); gripPart(gg, rn, { len: 0.22, r: 0.03, col: rn.pick(GRIP_COLORS), fitting });
  pommelPart(g, rn, rn.pick(['ball', 'disc', 'gem']), -0.13, fitting, L.rarity !== 'common' && gemC ? gemMat(gemC) : null);
  const n0 = g.children.length;
  if (t === 1 || t === 3) { // flanged
    g.add(mesh(lathe([[0.04, top - 0.08], [0.06, top], [0.05, top + 0.12], [0.02, top + 0.16]], 12), headMat));
    const n = t === 1 ? 6 : 8; const fl = extrude([[0, -0.08], [0.05, -0.05], [0.075, 0.03], [0.06, 0.11], [0, 0.14]], 0.016, 0.004);
    for (let i = 0; i < n; i++) { const f = mesh(fl, headMat, 0, top, 0); f.rotation.y = i / n * Math.PI * 2; g.add(f); }
    if (t === 3) for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; const sp = mesh(new THREE.ConeGeometry(0.012, 0.06, 5), fitting, Math.cos(a) * 0.09, top + 0.03, Math.sin(a) * 0.09); sp.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2); g.add(sp); }
    g.add(mesh(new THREE.ConeGeometry(0.03, 0.08, 6), headMat, 0, top + 0.18, 0));
  } else if (t === 2) { // morningstar
    const b = mesh(new THREE.IcosahedronGeometry(0.1, 2), headMat, 0, top + 0.06, 0); g.add(b);
    const ico = new THREE.IcosahedronGeometry(0.1, 0).attributes.position; const seen = new Set();
    for (let i = 0; i < ico.count; i++) {
      const v = new THREE.Vector3(ico.getX(i), ico.getY(i), ico.getZ(i)).normalize(); const k = v.toArray().map((q) => q.toFixed(2)).join();
      if (seen.has(k)) continue; seen.add(k);
      const sp = mesh(new THREE.ConeGeometry(0.02, 0.09, 6), fitting, v.x * 0.12, top + 0.06 + v.y * 0.12, v.z * 0.12);
      sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); g.add(sp);
    }
  } else if (t === 4) { // grave maul
    g.add(mesh(rbox(0.32, 0.17, 0.17, 0.02), headMat, 0, top + 0.06, 0));
    for (const s of [-1, 1]) g.add(mesh(rbox(0.04, 0.2, 0.2, 0.012), fitting, s * 0.15, top + 0.06, 0));
    const bone = common('bone', { rough: 0.6 });
    const sk = mesh(new THREE.SphereGeometry(0.06, 12, 10), bone, 0, top + 0.07, 0.085); sk.scale.set(1, 1.1, 0.7); g.add(sk);
    for (const x of [-0.022, 0.022]) g.add(mesh(new THREE.SphereGeometry(0.013, 6, 4), gemMat(L.col ?? 0xff3a20), x, top + 0.08, 0.125));
    const sp = mesh(new THREE.ConeGeometry(0.03, 0.12, 6), fitting, 0, top + 0.2, 0); g.add(sp);
  } else { // sunhammer
    const gold = metalMat('gilded');
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 24), gold, 0, top + 0.1, 0).rotateX(Math.PI / 2));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const r = mesh(new THREE.ConeGeometry(0.025, 0.1, 4), gold, Math.cos(a) * 0.17, top + 0.1 + Math.sin(a) * 0.17, 0); r.rotation.z = a - Math.PI / 2; g.add(r); }
    g.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), gemMat(L.col ?? 0xffb030), 0, top + 0.1, 0.04));
    g.add(mesh(new THREE.SphereGeometry(0.06, 16, 12), gemMat(L.col ?? 0xffb030), 0, top + 0.1, -0.04));
    g.add(mesh(rbox(0.1, 0.1, 0.08, 0.015), gold, 0, top - 0.02, 0));
  }
  // scale the whole head up around the top of the shaft so it reads at game distance
  const head = new THREE.Group(); head.position.y = top; head.scale.setScalar(1.35);
  for (const c of g.children.slice(n0)) { c.position.y -= top; head.add(c); }
  g.add(head);
  if (L.rarity === 'legendary') runeHalo(g, top + 0.1, 0.26, L.col ?? 0xffa040);
  return top + 0.08;
}

// ---------------------------------------------------------------- staves
// Quarterstaff · Oak Staff · Runed Staff · Spirit Staff · Grave Staff · Staff of Embers
function staff(g, L, rn) {
  const t = L.tier;
  const top = 1.22;
  const wood = common(t >= 3 ? 'darkwood' : 'wood', { rough: 0.9, color: rn.pick([0xffffff, 0xe8d8c8, 0xd0c0b0]) });
  const bend = rn.f(-0.03, 0.03);
  g.add(mesh(sweep([[0, -0.5, 0], [bend, 0.2, 0.01], [-bend, 0.8, -0.01], [0, top, 0]], (u) => 0.03 * (1 - u * 0.15) + (u > 0.92 ? (u - 0.92) * 0.3 : 0), { seg: 48, rad: 9, lumpy: t >= 1 ? 0.35 : 0.1, seed: L.s }), wood));
  const fitting = metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common));
  g.add(mesh(lathe([[0.034, -0.52], [0.038, -0.46], [0.034, -0.44]], 10), fitting));
  const gg = new THREE.Group(); gg.position.y = 0.02; g.add(gg); gripPart(gg, rn, { len: 0.26, r: 0.033, col: rn.pick(GRIP_COLORS), fitting });
  const orbC = L.col ?? [0x7ad0ff, 0x9aff6a, 0x7ad0ff, 0x9a7aff, 0x6aff9a, 0xff7a20][t];
  const orb = gemMat(orbC);
  if (t === 0) { g.add(mesh(lathe([[0.034, top - 0.06], [0.04, top], [0.02, top + 0.03]], 10), fitting)); return top; }
  if (t === 1) { // knotted crook with leaves
    g.add(mesh(sweep([[0, top - 0.05, 0], [0.04, top + 0.12, 0], [0.11, top + 0.16, 0], [0.13, top + 0.06, 0]], (u) => 0.026 * (1 - u * 0.5), { seg: 20, rad: 7 }), wood));
    const leaf = flat(0x5a9a3a, { rough: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) { const lf = mesh(extrude([[0, 0], [0.02, 0.03], [0, 0.07], [-0.02, 0.03]], 0.002, 0), leaf, 0.04 + i * 0.02, top + 0.12 - i * 0.03, 0.02); lf.rotation.set(rn.f(-1, 1), rn.f(0, 6), rn.f(-1, 1)); g.add(lf); }
    g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), orb, 0.13, top + 0.02, 0));
    return top + 0.1;
  }
  if (t === 2 || t === 5) { // cradle of prongs around a crystal / ember cage
    const n = t === 5 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      g.add(mesh(sweep([[0, top - 0.04, 0], [Math.cos(a) * 0.07, top + 0.06, Math.sin(a) * 0.07], [Math.cos(a) * 0.08, top + 0.18, Math.sin(a) * 0.08], [Math.cos(a) * 0.03, top + 0.27, Math.sin(a) * 0.03]], (u) => 0.016 * (1 - u * 0.6), { seg: 16, rad: 6 }), t === 5 ? metalMat('black') : wood));
    }
    const c = mesh(new THREE.OctahedronGeometry(0.06, 0), orb, 0, top + 0.14, 0); c.scale.y = 1.7; g.add(c);
    if (t === 5) g.add(mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(orbC).multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0, top + 0.14, 0));
    runeRow(g, rn, { from: 0.2, to: 0.75, z: 0.034, size: 0.035, col: L.col ?? RUNE_DEFAULT[3] });
    if (L.rarity === 'legendary') runeHalo(g, top + 0.14, 0.16, orbC);
    return top + 0.14;
  }
  if (t === 3) { // spirit hoop with a floating orb and feathers
    const hoop = mesh(new THREE.TorusGeometry(0.12, 0.016, 8, 28), wood, 0, top + 0.14, 0); g.add(hoop);
    const o = mesh(new THREE.SphereGeometry(0.05, 18, 14), orb, 0, top + 0.14, 0); g.add(o);
    const feather = flat(rn.pick([0xe8e0d0, 0x3a3a3a, 0xa04a2a]), { rough: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) { g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 3), common('leather'), -0.1 + i * 0.03, top + 0.0 - i * 0.02, 0)); const f = mesh(extrude([[0, 0], [0.015, -0.04], [0, -0.1], [-0.015, -0.04]], 0.002, 0), feather, -0.1 + i * 0.03, top - 0.06 - i * 0.02, 0); g.add(f); }
    g.userData.bob = o;
    if (L.rarity === 'legendary') runeHalo(g, top + 0.14, 0.18, orbC);
    return top + 0.14;
  }
  // t4: grave staff — a horned skull with a sickly glow in its eyes
  const bone = common('bone', { rough: 0.6 });
  const sk = mesh(new THREE.SphereGeometry(0.075, 14, 12), bone, 0, top + 0.08, 0); sk.scale.set(0.95, 1.05, 1.05); g.add(sk);
  g.add(mesh(rbox(0.09, 0.05, 0.08, 0.015), bone, 0, top + 0.02, 0.02));
  for (const s of [-1, 1]) {
    g.add(mesh(sweep([[s * 0.06, top + 0.12, 0], [s * 0.14, top + 0.16, -0.02], [s * 0.17, top + 0.26, -0.04], [s * 0.13, top + 0.32, -0.02]], (u) => 0.02 * (1 - u * 0.9), { seg: 18, rad: 6 }), bone));
    g.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), orb, s * 0.026, top + 0.09, 0.065));
  }
  if (L.rarity === 'legendary') runeHalo(g, top + 0.1, 0.18, orbC);
  return top + 0.1;
}

// ---------------------------------------------------------------- shields
// Buckler · Kite Shield · Tower Shield · Aegis · Bulwark · Dragonguard
const TINCTURES = [0x7a1216, 0x182a62, 0x18481e, 0x1c1a1e, 0x4a1856, 0x1a4a52, 0x5a2a12];
const METAL_T = [0xb88a2a, 0xb4b4b0];
// Stat colours become proper heraldic paint: deep and saturated, never pastel.
const tincture = (col) => { const c = new THREE.Color(col); const h = {}; c.getHSL(h, THREE.SRGBColorSpace); return c.setHSL(h.h, Math.min(0.75, Math.max(0.5, h.s)), 0.3, THREE.SRGBColorSpace).getHex(); };
const heraldryCache = new Map();
function heraldry(L, rn) {
  const key = `${L.s}:${L.col}:${L.col2}:${L.tier}`;
  if (heraldryCache.has(key)) return heraldryCache.get(key);
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const hex = (n) => `#${new THREE.Color(n).getHexString()}`;
  const darken = (n, k) => `#${new THREE.Color(n).multiplyScalar(k).getHexString()}`;
  const t1 = L.col != null ? tincture(L.col) : rn.pick(TINCTURES);
  let t2 = L.col2 != null ? tincture(L.col2) : rn.pick(METAL_T.concat(TINCTURES));
  if (t2 === t1) t2 = METAL_T[0];
  if (rn.chance(0.5) && t2 !== METAL_T[0] && t2 !== METAL_T[1]) t2 = rn.pick(METAL_T); // rule of tincture: colour on metal
  const metal = METAL_T.includes(t2) ? rn.pick(TINCTURES.filter((x) => x !== t1)) : rn.pick(METAL_T);
  // base: weathered planks for low tiers, hammered metal above
  const wood = L.tier <= 1;
  g.fillStyle = wood ? '#6a4a2c' : '#8a8a8e'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${wood ? '30,18,8' : '20,20,24'},${rn.f(0.02, 0.08)})`; const x = rn.f(0, S); g.fillRect(x, rn.f(0, S), wood ? rn.f(1, 3) : rn.f(2, 6), wood ? rn.f(20, 80) : rn.f(2, 6)); }
  if (wood) for (let i = 1; i < 6; i++) { g.fillStyle = 'rgba(20,10,4,0.55)'; g.fillRect(i * S / 6 - 1, 0, 2, S); }
  g.globalAlpha = 0.88;
  g.fillStyle = hex(t1); g.fillRect(0, 0, S, S);
  g.fillStyle = hex(t2);
  const div = rn.pick(['plain', 'pale', 'fess', 'bend', 'quarterly', 'chevron', 'saltire', 'bordure', 'chief', 'paly']);
  g.beginPath();
  if (div === 'pale') g.rect(S / 2, 0, S / 2, S);
  else if (div === 'fess') g.rect(0, S * 0.4, S, S * 0.22);
  else if (div === 'bend') { g.moveTo(0, 0); g.lineTo(S * 0.25, 0); g.lineTo(S, S * 0.75); g.lineTo(S, S); g.lineTo(S * 0.75, S); g.lineTo(0, S * 0.25); }
  else if (div === 'quarterly') { g.rect(S / 2, 0, S / 2, S / 2); g.rect(0, S / 2, S / 2, S / 2); }
  else if (div === 'chevron') { g.moveTo(0, S * 0.9); g.lineTo(S / 2, S * 0.38); g.lineTo(S, S * 0.9); g.lineTo(S, S * 0.68); g.lineTo(S / 2, S * 0.16); g.lineTo(0, S * 0.68); }
  else if (div === 'saltire') { for (const [a, b] of [[0, S], [S, 0]]) { g.moveTo(a - 20, 0); g.lineTo(a + 20, 0); g.lineTo(b + 20, S); g.lineTo(b - 20, S); } }
  else if (div === 'bordure') { g.rect(0, 0, S, S); g.rect(S - 22, 22, -(S - 44), S - 44); }
  else if (div === 'chief') g.rect(0, 0, S, S * 0.3);
  else if (div === 'paly') for (let i = 1; i < 6; i += 2) g.rect(i * S / 6, 0, S / 6, S);
  g.fill('evenodd');
  // charge
  const charge = rn.pick(['cross', 'star', 'sun', 'crown', 'skull', 'tower', 'moon', 'sword', 'tree', 'none']);
  g.fillStyle = hex(metal); g.strokeStyle = darken(metal, 0.45); g.lineWidth = 4;
  const cx = S / 2; const cy = S * 0.5; const R = S * 0.2;
  g.save(); g.translate(cx, cy); g.beginPath();
  if (charge === 'cross') { g.rect(-R * 0.25, -R, R * 0.5, R * 2); g.rect(-R, -R * 0.35, R * 2, R * 0.5); }
  else if (charge === 'star') for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? R * 0.45 : R; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  else if (charge === 'sun') { for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; const r = i % 2 ? R * 0.7 : R * 1.05; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } }
  else if (charge === 'crown') { g.moveTo(-R, R * 0.5); g.lineTo(-R, -R * 0.4); g.lineTo(-R * 0.5, R * 0.05); g.lineTo(0, -R * 0.6); g.lineTo(R * 0.5, R * 0.05); g.lineTo(R, -R * 0.4); g.lineTo(R, R * 0.5); }
  else if (charge === 'skull') { g.arc(0, -R * 0.1, R * 0.75, 0, Math.PI * 2); g.rect(-R * 0.45, R * 0.4, R * 0.9, R * 0.45); }
  else if (charge === 'tower') { g.rect(-R * 0.55, -R * 0.5, R * 1.1, R * 1.5); for (let i = 0; i < 3; i++) g.rect(-R * 0.65 + i * R * 0.5, -R * 0.85, R * 0.3, R * 0.4); }
  else if (charge === 'moon') { g.arc(0, 0, R, 0.4, Math.PI * 2 - 0.4); g.arc(R * 0.45, 0, R * 0.8, Math.PI * 2 - 0.6, 0.6, true); }
  else if (charge === 'sword') { g.rect(-R * 0.12, -R * 1.1, R * 0.24, R * 1.6); g.rect(-R * 0.6, R * 0.45, R * 1.2, R * 0.18); g.rect(-R * 0.1, R * 0.6, R * 0.2, R * 0.5); }
  else if (charge === 'tree') { g.arc(0, -R * 0.3, R * 0.7, 0, Math.PI * 2); g.rect(-R * 0.15, 0, R * 0.3, R * 1.0); }
  g.restore();
  if (charge !== 'none') { g.fill('nonzero'); g.stroke(); }
  // wear: paint chipped back to the wood/metal, scratches, grime
  g.globalAlpha = 1;
  for (let i = 0; i < 60; i++) { g.fillStyle = wood ? 'rgba(90,62,36,0.7)' : 'rgba(130,130,136,0.7)'; g.beginPath(); g.arc(rn.f(0, S), rn.f(0, S), rn.f(1, 4), 0, 7); g.fill(); }
  g.globalAlpha = 0.25; g.strokeStyle = '#000';
  for (let i = 0; i < 40; i++) { g.lineWidth = rn.f(0.5, 2); g.beginPath(); const x = rn.f(0, S); const y = rn.f(0, S); g.moveTo(x, y); g.lineTo(x + rn.f(-30, 30), y + rn.f(-10, 10)); g.stroke(); }
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.75); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.globalAlpha = 1; g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  if (heraldryCache.size > 80) heraldryCache.delete(heraldryCache.keys().next().value);
  heraldryCache.set(key, tex);
  return tex;
}

function planarUV(geo) {
  geo.computeBoundingBox(); const b = geo.boundingBox;
  const p = geo.attributes.position; const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
}

function outlineOf(t, rn) {
  const pts = [];
  const add = (x, y) => pts.push([x, y]);
  if (t === 0 || t === 3) { // round
    const r = t === 0 ? 0.3 : 0.4; const n = 40;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; add(Math.cos(a) * r, Math.sin(a) * r); }
  } else if (t === 1) { // heater / kite
    const w = 0.3 * rn.f(0.95, 1.06); const top = 0.32; const mid = rn.f(0.0, 0.1); const bot = -0.5 * rn.f(0.95, 1.12);
    for (let i = 0; i <= 8; i++) { const k = i / 8; add(-w + k * 2 * w, top + Math.sin(k * Math.PI) * 0.03); }
    for (let i = 0; i <= 14; i++) { const k = i / 14; add(w * Math.cos(k * Math.PI / 2) ** 0.9, top - (top - mid) * Math.min(1, k * 3) - (mid - bot) * Math.max(0, (k * 3 - 1) / 2) * (k > 0.33 ? 1 : 0)); }
    for (let i = 13; i > 0; i--) { const k = i / 14; add(-w * Math.cos(k * Math.PI / 2) ** 0.9, top - (top - mid) * Math.min(1, k * 3) - (mid - bot) * Math.max(0, (k * 3 - 1) / 2) * (k > 0.33 ? 1 : 0)); }
  } else if (t === 2 || t === 4) { // tower / bulwark: tall slightly curved-top rectangle
    const w = t === 2 ? 0.34 : 0.38; const h = t === 2 ? 0.86 : 0.8;
    add(-w, -h / 2); add(w, -h / 2);
    for (let i = 0; i <= 10; i++) { const k = i / 10; add(w - k * w * 2, h / 2 + Math.sin(k * Math.PI) * 0.06); }
  } else { // dragonguard: heater with flared wing-tips
    add(-0.36, 0.34); add(-0.22, 0.28); add(0, 0.36); add(0.22, 0.28); add(0.36, 0.34); add(0.3, 0.05);
    for (let i = 1; i < 10; i++) { const k = i / 10; add(0.3 * (1 - k) ** 0.7, 0.05 - k * 0.55); }
    add(0, -0.52);
    for (let i = 9; i > 0; i--) { const k = i / 10; add(-0.3 * (1 - k) ** 0.7, 0.05 - k * 0.55); }
    add(-0.3, 0.05);
  }
  return pts;
}

function shield(g, L, rn) {
  const t = L.tier;
  const out = outlineOf(t, rn);
  const fitting = metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common));
  const face = new THREE.Shape(out.map(([x, y]) => V2(x, y)));
  const geo = new THREE.ExtrudeGeometry(face, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -0.02);
  // bow the face outward a little
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); const y = p.getY(i); p.setZ(i, p.getZ(i) - (x * x + y * y * 0.4) * (t === 2 || t === 4 ? 0.25 : 0.35)); }
  geo.computeVertexNormals(); planarUV(geo);
  const painted = t === 0 && L.rarity === 'common'
    ? common('wood', { rough: 0.8 })
    : new THREE.MeshStandardMaterial({ map: heraldry(L, rn), roughness: 0.72, metalness: t <= 1 ? 0 : 0.25 });
  g.add(mesh(geo, painted));
  // rim
  const rimPts = out.map(([x, y]) => [x, y, -(x * x + y * y * 0.4) * (t === 2 || t === 4 ? 0.25 : 0.35) + 0.01]);
  rimPts.push(rimPts[0]);
  const rimPath = new THREE.CurvePath();
  for (let i = 0; i < rimPts.length - 1; i++) rimPath.add(new THREE.LineCurve3(new THREE.Vector3(...rimPts[i]), new THREE.Vector3(...rimPts[i + 1])));
  g.add(mesh(new THREE.TubeGeometry(rimPath, out.length * 2, t >= 3 ? 0.022 : 0.016, 6, true), fitting));
  // boss
  const gemC = L.col ?? RARITY_GEM[L.rarity];
  if (t === 0 || t === 3) {
    g.add(mesh(lathe([[0.1, 0], [0.09, 0.03], [0.06, 0.06], [0.001, 0.07]], 18).rotateX(Math.PI / 2), fitting, 0, 0, 0.02));
    if (t === 3) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const ray = mesh(new THREE.ConeGeometry(0.018, 0.12, 4), fitting, Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.0); ray.rotation.z = a - Math.PI / 2; g.add(ray); }
  }
  if (t === 4) { // spiked bulwark
    for (let i = 0; i < 8; i++) { const k = (i % 4) / 3; const x = (k - 0.5) * 0.56; const y = i < 4 ? 0.36 : -0.36; const sp = mesh(new THREE.ConeGeometry(0.025, 0.12, 6), fitting, x, y, 0.0); sp.rotation.x = Math.PI / 2; g.add(sp); }
    g.add(mesh(new THREE.ConeGeometry(0.06, 0.2, 8).rotateX(Math.PI / 2), fitting, 0, 0.05, 0.08));
  }
  if (t === 5) { // dragon skull crest
    g.add(mesh(extrude([[-0.12, 0.1], [0, 0.18], [0.12, 0.1], [0.08, -0.08], [0, -0.16], [-0.08, -0.08]], 0.03, 0.01, 2), metalMat('gilded'), 0, 0.02, 0.02));
    for (const s of [-1, 1]) { const h = mesh(new THREE.ConeGeometry(0.02, 0.18, 6), metalMat('gilded'), s * 0.12, 0.2, 0.04); h.rotation.z = -s * 0.5; g.add(h); }
  }
  if (gemC && L.rarity !== 'common') { const gm = mesh(new THREE.OctahedronGeometry(0.04), gemMat(gemC), 0, t === 5 ? 0.0 : t === 0 || t === 3 ? 0 : 0.12, 0.09); gm.scale.set(1, 1.3, 0.6); g.add(gm); }
  if (L.rarity === 'rare' || L.rarity === 'legendary') {
    const col = L.col ?? 0xffc040;
    for (let i = 0; i < 12; i++) {
      const [x, y] = out[Math.floor(i / 12 * out.length)];
      const q = mesh(runeQuad(i % 16, 0.05), runeMat(col), x * 0.82, y * 0.82, -(x * x + y * y * 0.4) * 0.3 + 0.03);
      q.castShadow = false; g.add(q);
    }
  }
  if (L.rarity === 'legendary') runeHalo(g, 0, 0.42, L.col ?? 0xffa040);
  return 0;
}

// ---------------------------------------------------------------- entry points
const BUILD = { sword, axe, mace, staff, shield };

/** Build a weapon or shield from an item look ({ kind, tier, rarity, col, el, col2, s }). */
export function forgeItem(look) {
  const L = { kind: 'sword', tier: 0, rarity: 'common', s: 1, ...look };
  L.tier = Math.max(0, Math.min(5, L.tier | 0));
  const g = new THREE.Group();
  const fn = BUILD[L.kind];
  if (!fn) return null;
  const rn = rngOf((L.s ^ (L.tier * 7919)) >>> 0);
  const tipY = fn(g, L, rn);
  g.traverse((o) => { if (o.isMesh && o.material?.transparent) o.castShadow = false; });
  g.userData.tipY = tipY;
  return g;
}

/** Spin legendary rune halos and bob spirit orbs; call once per frame for visible weapons. */
export function animateForged(obj, t) {
  for (const r of obj.userData.spinners || []) r.rotation.y = t * r.userData.spin;
  if (obj.userData.bob) obj.userData.bob.position.x = Math.sin(t * 2) * 0.01;
}

// ---------------------------------------------------------------- armour palettes
// Materials for one equipped armour piece, chosen from the item the same way weapons are:
// its own metal / leather / wood shade, trim by rarity, enamel and runes in its stat colours.
const LEATHERS = [0x6a4428, 0x4a2e1a, 0x5a2a1a, 0x3a2a22, 0x6a5038, 0x2a2420];
const palCache = new Map();
export function gearPalette(look) {
  const L = { tier: 0, rarity: 'common', s: 7, ...look };
  const key = `${L.s}:${L.tier}:${L.rarity}:${L.col}:${L.col2}`;
  if (palCache.has(key)) return palCache.get(key);
  const rn = rngOf((L.s ^ 0x5bd1e995) >>> 0);
  const t = Math.max(0, Math.min(5, L.tier | 0));
  const enamelCol = L.col != null ? tincture(L.col) : rn.pick(TINCTURES);
  const runeCol = L.col ?? [0x9ad0ff, 0x9ad0ff, 0x9ad0ff, 0x8ab8ff, 0xff4a3a, 0xffa040][t];
  const pal = {
    armor: metalMat(rn.pick(TIER_METALS[t])),
    armorL: common('leather', { color: rn.pick(LEATHERS), rough: 0.75 }),
    armorW: common(t >= 4 ? 'darkwood' : 'wood', { color: rn.pick([0xffffff, 0xe0d0c0, 0xc8b8a8]), rough: 0.9 }),
    trim: metalMat(rn.pick(FITTINGS[L.rarity] || FITTINGS.common)),
    enamel: common('clothN', { color: enamelCol, rough: 0.85 }),
    rune: flat(runeCol, { emissive: runeCol, emissiveIntensity: L.rarity === 'common' && t < 5 ? 0.6 : 2.2, rough: 0.3 }),
  };
  if (palCache.size > 200) palCache.delete(palCache.keys().next().value);
  palCache.set(key, pal);
  return pal;
}
