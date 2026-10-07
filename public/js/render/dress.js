// Set dressing for dungeons, generated on the client from the map (purely visual, never
// blocks movement). Everything hugs the walls inside the 0.45 m the collision keeps heroes
// away from them, or lies flat on the floor, so nothing is ever walked through.
import * as THREE from 'three';
import { TILE, T } from '/shared/map.js';
import { RNG, hashSeed } from '/shared/rng.js';
import { common, flat, glow, texMat, softTexture } from './materials.js';
import { THEME_TEX } from './textures.js';
import { buildStatue } from './models.js';
import * as P from './props.js';
import { CutBatcher } from './cut.js';

const UP = new THREE.Vector3(0, 1, 0);
const m4 = (x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx, rotX = 0, rotZ = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(sx, sy, sz));

// ---------------------------------------------------------------- textures
let atlasTex = null;
const CELLS = { crack: 0, stain: 1, puddle: 2, grate: 3, runes: 4, moss: 5, scorch: 6, lava: 7 };
function decalAtlas() {
  if (atlasTex) return atlasTex;
  const C = 256; const c = document.createElement('canvas'); c.width = C * 4; c.height = C * 2;
  const g = c.getContext('2d');
  let s = 1234567; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const at = (i) => { g.setTransform(1, 0, 0, 1, (i % 4) * C, Math.floor(i / 4) * C); };
  const crack = (x, y, a, len, w, depth) => {
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * len / 7; y += Math.sin(a) * len / 7; g.lineTo(x, y); if (depth > 0 && r() < 0.3) { g.stroke(); crack(x, y, a + (r() - 0.5) * 2, len * 0.5, w * 0.6, depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); } }
    g.stroke();
  };
  const blob = (cx, cy, rad, n, col) => { for (let k = 0; k < n; k++) { const a = r() * 6.28; const d = r() * rad * 0.6; const rr = rad * (0.25 + r() * 0.45); const gr = g.createRadialGradient(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr); gr.addColorStop(0, col(1)); gr.addColorStop(0.7, col(0.6)); gr.addColorStop(1, col(0)); g.fillStyle = gr; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, 7); g.fill(); } };
  // crack
  at(0); g.strokeStyle = 'rgba(8,6,5,0.85)'; g.lineCap = 'round';
  for (let k = 0; k < 3; k++) crack(128, 128, r() * 6.28, 120, 4, 2);
  // stain (old blood / grime)
  at(1); blob(128, 128, 110, 14, (a) => `rgba(52,10,6,${a * 0.42})`);
  for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(48,8,4,${0.3 + r() * 0.4})`; const a = r() * 6.28; const d = 70 + r() * 50; g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1 + r() * 4, 0, 7); g.fill(); }
  // puddle
  at(2); blob(128, 128, 120, 10, (a) => `rgba(255,255,255,${a})`);
  // grate
  at(3); g.fillStyle = 'rgba(6,6,6,0.95)'; g.fillRect(40, 40, 176, 176);
  g.fillStyle = 'rgba(70,70,74,1)'; g.fillRect(28, 28, 200, 14); g.fillRect(28, 214, 200, 14); g.fillRect(28, 28, 14, 200); g.fillRect(214, 28, 14, 200);
  for (let k = 0; k < 6; k++) g.fillRect(58 + k * 28, 40, 9, 176);
  // runes
  at(4); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 118, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 96, 0, 7); g.stroke(); g.beginPath(); g.arc(128, 128, 40, 0, 7); g.stroke();
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; g.save(); g.translate(128 + Math.cos(a) * 107, 128 + Math.sin(a) * 107); g.rotate(a); g.beginPath(); g.moveTo(-5, -6); g.lineTo(0, 6); g.lineTo(5, -6); if (k % 2) { g.moveTo(-5, 0); g.lineTo(5, 0); } g.stroke(); g.restore(); }
  g.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; g[k ? 'lineTo' : 'moveTo'](128 + Math.cos(a) * 94, 128 + Math.sin(a) * 94); } g.closePath(); g.stroke();
  // moss
  at(5); for (let k = 0; k < 500; k++) { const a = r() * 6.28; const d = Math.sqrt(r()) * 110; g.fillStyle = `rgba(${40 + r() * 30 | 0},${70 + r() * 40 | 0},${20 + r() * 20 | 0},${0.5 + r() * 0.4})`; g.beginPath(); g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + r() * 5 * (1 - d / 120), 0, 7); g.fill(); }
  // scorch
  at(6); blob(128, 128, 120, 8, (a) => `rgba(4,2,1,${a * 0.75})`);
  // lava crack (white-hot core, orange glow; tinted later)
  at(7); g.lineCap = 'round'; g.shadowColor = 'rgba(255,120,30,1)'; g.shadowBlur = 18; g.strokeStyle = 'rgba(255,110,20,0.9)';
  for (let k = 0; k < 3; k++) crack(128, 128, r() * 6.28, 118, 7, 2);
  g.shadowBlur = 0; g.strokeStyle = 'rgba(255,230,140,1)'; s = 1234567 + 99;
  g.setTransform(1, 0, 0, 1, 3 * C, C);
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 4;
  return atlasTex;
}

let webTex = null;
function webTexture() {
  if (webTex) return webTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.strokeStyle = 'rgba(235,235,230,0.55)'; g.lineWidth = 1.3;
  const ox = 128; const oy = 250; const n = 9; const ends = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); ends.push([t * 256, 4 + Math.sin(t * Math.PI) * 6]); }
  for (const [x, y] of ends) { g.beginPath(); g.moveTo(ox, oy); g.lineTo(x, y); g.stroke(); }
  for (let k = 1; k < 9; k++) {
    const f = k / 9; g.beginPath();
    for (let i = 0; i < n; i++) { const x = ox + (ends[i][0] - ox) * f; const y = oy + (ends[i][1] - oy) * f; if (!i) g.moveTo(x, y); else { const px = ox + (ends[i - 1][0] - ox) * f; const py = oy + (ends[i - 1][1] - oy) * f; g.quadraticCurveTo((x + px) / 2, (y + py) / 2 + 8 * f, x, y); } }
    g.stroke();
  }
  webTex = new THREE.CanvasTexture(c); webTex.colorSpace = THREE.SRGBColorSpace;
  return webTex;
}

let fallTex = null;
function lavaFallTexture() {
  if (fallTex) return fallTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 14 + Math.random() * 36; const w = 2 + Math.random() * 7;
    const gr = g.createLinearGradient(x - w, 0, x + w, 0);
    gr.addColorStop(0, 'rgba(255,90,10,0)'); gr.addColorStop(0.5, `rgba(255,${150 + Math.random() * 90 | 0},60,${0.4 + Math.random() * 0.5})`); gr.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = gr; const y = Math.random() * 256; g.fillRect(x - w, y, w * 2, 40 + Math.random() * 140); g.fillRect(x - w, y - 256, w * 2, 40 + Math.random() * 140);
  }
  fallTex = new THREE.CanvasTexture(c); fallTex.colorSpace = THREE.SRGBColorSpace; fallTex.wrapT = THREE.RepeatWrapping;
  return fallTex;
}

// ---------------------------------------------------------------- materials (cached)
const M = {};
function mats(theme) {
  const k = theme;
  if (M[k]) return M[k];
  const t = THEME_TEX[theme]?.wall ? THEME_TEX[theme] : THEME_TEX.crypt;
  const atlas = decalAtlas();
  const decal = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const puddle = new THREE.MeshStandardMaterial({ map: atlas, color: theme === 'cavern' ? 0x3a4448 : 0x34383e, transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.04, metalness: 0.1, envMapIntensity: 3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const add = (col) => new THREE.MeshBasicMaterial({ map: atlas, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const pool = new THREE.MeshBasicMaterial({ map: softTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const web = new THREE.MeshBasicMaterial({ map: webTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9a9a98 });
  const ft = lavaFallTexture();
  const fall = new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(2.2, 1.0, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  M[k] = {
    decal, puddle, pool, web, fall, fallTex: ft,
    runes: add(theme === 'infernal' ? new THREE.Color(2.4, 0.5, 0.15) : theme === 'cavern' ? new THREE.Color(0.3, 1.6, 1.3) : new THREE.Color(0.6, 0.8, 2.4)),
    lava: add(new THREE.Color(2.6, 1.2, 0.5)),
    stone: texMat(`${theme}-trim`, t.trim || t.pillar, { rough: 0.9, size: 256 }),
    statue: texMat(`${theme}-statue`, theme === 'infernal' ? THEME_TEX.extra.obsidianStatue : THEME_TEX.extra.statue, { rough: theme === 'infernal' ? 0.35 : 0.85, size: 256 }),
    rock: texMat(`${theme}-pillar`, t.pillar, { size: 256 }),
    iron: common('iron', { metal: 0.7, rough: 0.45 }),
    wood: common('darkwood', { rough: 0.85 }),
    bone: common('bone', { rough: 0.75 }),
    wax: flat(0xe8dcc0, { rough: 0.6 }),
    obsidian: flat(0x120c10, { rough: 0.12, metal: 0.4 }),
    crystal: flat(0x8a6aff, { emissive: 0x6a4aff, emissiveIntensity: 2.2, rough: 0.15, metal: 0.1 }),
    crystal2: flat(0x4adacc, { emissive: 0x20c0b0, emissiveIntensity: 2.0, rough: 0.15, metal: 0.1 }),
    fungus: flat(0x3ab0a0, { emissive: 0x20d0b8, emissiveIntensity: 1.6, rough: 0.6 }),
    cloth: common('clothN', { rough: 0.95, color: theme === 'infernal' ? 0x4a0a0a : 0x6a1216 }),
    gold: common('gold', { metal: 0.85, rough: 0.35 }),
  };
  return M[k];
}

// Plane lying on the floor (or on a wall when `wall` is set) mapped to one atlas cell.
const decalGeoCache = new Map();
function decalGeo(cell) {
  if (decalGeoCache.has(cell)) return decalGeoCache.get(cell);
  const g = new THREE.PlaneGeometry(1, 1);
  const col = cell % 4; const row = Math.floor(cell / 4);
  const u0 = col / 4; const u1 = (col + 1) / 4; const v0 = 1 - (row + 1) / 2; const v1 = 1 - row / 2;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  g.rotateX(-Math.PI / 2);
  decalGeoCache.set(cell, g);
  return g;
}

let poolG = null;
const poolGeo = () => poolG || (poolG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

function jitterGeo(g, amt, rnd) {
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt * 0.6, (rnd() - 0.5) * amt]);
    const d = seen.get(key);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- main
export function dressDungeon(map, ctx) {
  const { root, cb, anim, lights, quality, theme, wallH } = ctx;
  const rng = new RNG(hashSeed('dress', map.floor, map.w, map.h, map.exit?.x));
  const rnd = () => rng.next();
  const mt = mats(theme);
  const dense = quality === 'high' ? 1 : quality === 'medium' ? 0.8 : 0.55;
  const open = (x, y) => { const v = map.get(x, y); return v === T.FLOOR || v === T.PILLAR; };
  const nearStairs = (x, y, r = 3.5) => (map.entry && Math.hypot(x - map.entry.x, y - map.entry.y) < r) || (map.exit && Math.hypot(x - map.exit.x, y - map.exit.y) < r);
  const torches = map.props.filter((p) => p.type === 'torch' || p.type === 'banner');
  const nearTorch = (x, y, r = 1.6) => torches.some((p) => Math.hypot(p.x - x, p.y - y) < r);
  const blocked = [];
  const free = (x, y, r) => !blocked.some(([bx, by, br]) => Math.hypot(bx - x, by - y) < r + br) && !nearStairs(x, y) && !nearTorch(x, y, r + 0.6);
  const take = (x, y, r) => blocked.push([x, y, r]);
  const tc = THEME_TEX[theme]?.torch || 0xffa040;
  let statues = 0;

  // Wall faces next to open floor: { x, y } face centre, (nx, ny) into the room, wall-tile centre.
  const faces = []; const corners = []; const floorTiles = [];
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (map.get(tx, ty) !== T.FLOOR) continue;
    const cx = tx * TILE + 1; const cy = ty * TILE + 1;
    floorTiles.push([cx, cy]);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (map.get(tx + dx, ty + dy) === T.WALL) faces.push({ x: cx + dx, y: cy + dy, nx: -dx, ny: -dy, cen: [cx + dx * 2, cy + dy * 2], rot: Math.atan2(-dx, -dy) });
    }
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (map.get(tx + dx, ty) === T.WALL && map.get(tx, ty + dy) === T.WALL) corners.push({ x: cx + dx, y: cy + dy, dx, dy, cen: [cx + dx * 2, cy + dy * 2], tx, ty });
    }
  }
  rng.shuffle(faces); rng.shuffle(corners);

  // Point on a face offset `along` the wall and `out` into the room.
  const onFace = (f, along = 0, out = 0) => [f.x + f.ny * along * -1 + f.nx * out, f.y + f.nx * along + f.ny * out];

  // ---- warm light pooling under every torch and brazier (fake bounce light)
  for (const p of map.props) {
    if (p.type !== 'torch' && p.type !== 'brazier') continue;
    const col = new THREE.Color(p.type === 'brazier' ? 0xff7a30 : tc);
    if (p.type === 'torch') {
      const fx = p.x + Math.sin(p.rot) * 1.0; const fy = p.y + Math.cos(p.rot) * 1.0;
      cb.add(poolGeo(), mt.pool, m4(fx, 0.012, fy, 0, 5.2), null, { colors: col.clone().multiplyScalar(0.16).toArray() });
      const wash = new THREE.PlaneGeometry(1, 1);
      const cen = [p.x - Math.sin(p.rot) * 1.05, p.y - Math.cos(p.rot) * 1.05];
      cb.add(wash, mt.pool, m4(p.x + Math.sin(p.rot) * 0.04, 2.35, p.y + Math.cos(p.rot) * 0.04, p.rot, 2.6, 2.8, 1), cen, { colors: col.clone().multiplyScalar(0.13).toArray() });
    } else {
      cb.add(poolGeo(), mt.pool, m4(p.x, 0.012, p.y, 0, 4.4), null, { colors: col.clone().multiplyScalar(0.2).toArray() });
    }
  }

  // ---- floor decals
  const decalAt = (cell, mat, x, y, size, k) => cb.add(decalGeo(cell), mat, m4(x, 0.008 + (k % 5) * 0.0012, y, rnd() * 6.28, size));
  const table = theme === 'crypt' ? [['crack', 9], ['stain', 3], ['puddle', 4], ['moss', 4], ['grate', 1.2]]
    : theme === 'cavern' ? [['puddle', 7], ['moss', 6], ['crack', 3], ['stain', 1]]
      : [['lava', 7], ['scorch', 6], ['crack', 4], ['stain', 3]];
  const totalW = table.reduce((a, [, w]) => a + w, 0);
  let k = 0;
  for (const [cx, cy] of floorTiles) {
    if (rnd() * 100 > totalW * dense) continue;
    const kind = rng.weighted(table);
    const x = cx + (rnd() - 0.5) * 1.2; const y = cy + (rnd() - 0.5) * 1.2;
    if (nearStairs(x, y, 2.6)) continue;
    const size = kind === 'grate' ? 1.0 : kind === 'puddle' ? 1.2 + rnd() * 1.6 : 1.1 + rnd() * 1.4;
    const mat = kind === 'puddle' ? mt.puddle : kind === 'lava' ? mt.lava : mt.decal;
    decalAt(CELLS[kind], mat, x, y, size, k++);
    if (kind === 'lava' && rnd() < 0.25) lights.push({ x, y, h: 0.6, color: 0xff5a10, weak: true });
  }
  // Boss rooms and the exit get a glowing ritual circle.
  for (const r of map.rooms || []) {
    if (!r.boss) continue;
    cb.add(decalGeo(CELLS.runes), mt.runes, m4(r.cx * TILE + 1, 0.015, r.cy * TILE + 1, 0, Math.min(r.w, r.h) * 1.3));
  }
  if (map.exit) cb.add(decalGeo(CELLS.runes), mt.runes, m4(map.exit.x, 0.015, map.exit.y, 0, 4.6));

  // ---- carpets down the middle of larger crypt / infernal halls
  if (theme !== 'cavern') {
    for (const r of map.rooms || []) {
      if (r.boss || r.w < 6 || r.h < 6 || rnd() > 0.45) continue;
      const alongX = r.w >= r.h;
      const len = (alongX ? r.w : r.h) * TILE - 2.4; const wid = 1.5;
      const cx = (r.x + r.w / 2) * TILE; const cy = (r.y + r.h / 2) * TILE;
      if (nearStairs(cx, cy, 4)) continue;
      const rot = alongX ? Math.PI / 2 : 0;
      cb.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mt.cloth, m4(cx, 0.02, cy, rot, wid, 1, len), null, { worldUV: true, uvScale: 1.2 });
      for (const s of [-1, 1]) cb.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mt.gold, m4(cx + (alongX ? 0 : s * wid * 0.42), 0.022, cy + (alongX ? s * wid * 0.42 : 0), rot, 0.08, 1, len - 0.1));
    }
  }

  // ---- wall pieces
  const want = Math.round(faces.length * (theme === 'cavern' ? 0.42 : 0.3) * dense);
  let placed = 0;
  for (const f of faces) {
    if (placed >= want) break;
    if (!free(f.x, f.y, 0.9)) continue;
    const roll = rnd();
    const ok = theme === 'crypt' ? cryptWall(f, roll) : theme === 'cavern' ? caveWall(f, roll) : hellWall(f, roll);
    if (ok) { take(f.x, f.y, 0.9); placed++; }
  }
  // ---- corners
  for (const c of corners) {
    if (nearStairs(c.x, c.y) || nearTorch(c.x, c.y, 1)) continue;
    const roll = rnd();
    if (theme !== 'infernal' && roll < 0.5 * dense) cobweb(c, wallH);
    if (theme === 'cavern' && rnd() < 0.5) stalagmites(c.x - c.dx * 0.35, c.y - c.dy * 0.35, c.cen, 3 + Math.floor(rnd() * 3), 1.6);
    else if (theme === 'crypt' && rnd() < 0.3) candleCluster(c.x - c.dx * 0.35, c.y - c.dy * 0.35);
    else if (theme === 'infernal' && rnd() < 0.45) spikes(c.x - c.dx * 0.3, c.y - c.dy * 0.3, c.cen, Math.atan2(-c.dx, -c.dy), 4);
  }
  return;

  // ================================================================ pieces
  function cryptWall(f, roll) {
    if (roll < 0.17) { coffin(f); return true; }
    if (roll < 0.27 && quality !== 'low' && statues < 3) { statues++; return statue(f); }
    if (roll < 0.47) { chains(f); return true; }
    if (roll < 0.64) { skullShelf(f); return true; }
    if (roll < 0.84) { rubbleAt(f); return true; }
    if (roll < 0.94) { plaque(f); return true; }
    return false;
  }
  function caveWall(f, roll) {
    if (roll < 0.34) { const [x, y] = onFace(f, (rnd() - 0.5) * 0.8, 0.28); stalagmites(x, y, f.cen, 2 + Math.floor(rnd() * 3), 1.8); return true; }
    if (roll < 0.5) { boulders(f); return true; }
    if (roll < 0.62) { crystals(f); return true; }
    if (roll < 0.76) { fungus(f); return true; }
    if (roll < 0.88) { shoring(f); return true; }
    return false;
  }
  function hellWall(f, roll) {
    if (roll < 0.28) { const [x, y] = onFace(f, (rnd() - 0.5) * 0.8, 0.22); spikes(x, y, f.cen, f.rot, 3 + Math.floor(rnd() * 3)); return true; }
    if (roll < 0.42) { lavaFall(f); return true; }
    if (roll < 0.58) { chains(f); return true; }
    if (roll < 0.7) { firePillar(f); return true; }
    if (roll < 0.86) { rubbleAt(f); return true; }
    return false;
  }

  function coffin(f) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.22, 0); sh.lineTo(0.22, 0); sh.lineTo(0.36, 1.45); sh.lineTo(0.26, 2.0); sh.lineTo(-0.26, 2.0); sh.lineTo(-0.36, 1.45); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    const [x, y] = onFace(f, (rnd() - 0.5) * 0.5, 0.02);
    cb.add(g, mt.stone, m4(x, 0.02, y, f.rot), f.cen, { worldUV: true });
    const crossM = m4(x + f.nx * 0.34, 1.3, y + f.ny * 0.34, f.rot);
    cb.add(new THREE.BoxGeometry(0.08, 0.7, 0.04), mt.stone, crossM, f.cen, { worldUV: true });
    cb.add(new THREE.BoxGeometry(0.36, 0.08, 0.04), mt.stone, m4(x + f.nx * 0.34, 1.45, y + f.ny * 0.34, f.rot), f.cen, { worldUV: true });
    // skull + candles at its foot
    if (rnd() < 0.6) { cb.add(new THREE.SphereGeometry(0.1, 8, 6), mt.bone, m4(x + f.nx * 0.45 + f.ny * 0.25, 0.09, y + f.ny * 0.45 - f.nx * 0.25, f.rot, 1, 0.9, 1.1)); }
    if (rnd() < 0.5) candleCluster(x + f.nx * 0.42 - f.ny * 0.3, y + f.ny * 0.42 + f.nx * 0.3);
  }

  function statue(f) {
    const s = buildStatue(rnd() < 0.5 ? 'hero_knight' : 'hero_berserker', mt.statue);
    if (!s) return false;
    const [x, y] = onFace(f, 0, 0.26);
    cb.add(new THREE.BoxGeometry(0.95, 0.42, 0.5), mt.stone, m4(x, 0.21, y, f.rot), f.cen, { worldUV: true });
    cb.add(new THREE.BoxGeometry(1.05, 0.1, 0.58), mt.stone, m4(x, 0.05, y, f.rot), f.cen, { worldUV: true });
    s.position.set(x - f.nx * 0.04, 0.42, y - f.ny * 0.04); s.rotation.y = f.rot; s.scale.setScalar(0.92);
    cb.addObject(s, f.cen);
    return true;
  }

  function chains(f) {
    const link = new THREE.TorusGeometry(0.06, 0.016, 3, 6);
    for (let c = 0; c < 2; c++) {
      const along = (c ? 0.35 : -0.35) + (rnd() - 0.5) * 0.2;
      const [x, y] = onFace(f, along, 0.06);
      const n = 7 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) cb.add(link, mt.iron, m4(x, 2.75 - i * 0.12, y, f.rot + (i % 2) * Math.PI / 2, 1, 1.45, 1), f.cen);
      cb.add(new THREE.TorusGeometry(0.1, 0.022, 4, 10), mt.iron, m4(x, 2.75 - n * 0.12 - 0.06, y, f.rot), f.cen);
    }
    const [bx, by] = onFace(f, 0, 0.04);
    cb.add(new THREE.BoxGeometry(1.0, 0.07, 0.07), mt.iron, m4(bx, 2.8, by, f.rot), f.cen);
  }

  function skullShelf(f) {
    const [x, y] = onFace(f, (rnd() - 0.5) * 0.4, 0.17);
    const h = 1.25 + rnd() * 0.4;
    cb.add(new THREE.BoxGeometry(1.3, 0.06, 0.32), mt.wood, m4(x, h, y, f.rot), f.cen, { worldUV: true });
    for (const s of [-0.5, 0.5]) cb.add(new THREE.BoxGeometry(0.05, 0.24, 0.05), mt.iron, m4(x - f.ny * s * -1 - f.nx * 0.08, h - 0.13, y + f.nx * s - f.ny * 0.08, f.rot, 1, 1, 1, 0.6), f.cen);
    for (let i = 0; i < 3; i++) {
      const al = -0.42 + i * 0.42 + (rnd() - 0.5) * 0.1;
      const [sx, sy] = [x - f.ny * al * -1, y + f.nx * al];
      if (rnd() < 0.7) cb.add(new THREE.SphereGeometry(0.1, 8, 6), mt.bone, m4(sx, h + 0.11, sy, f.rot + (rnd() - 0.5), 1, 0.9, 1.15), f.cen);
      else { const ch = 0.12 + rnd() * 0.12; cb.add(new THREE.CylinderGeometry(0.035, 0.04, ch, 6), mt.wax, m4(sx, h + 0.03 + ch / 2, sy), f.cen); addFlame(sx, h + 0.06 + ch, sy, 0.22); }
    }
  }

  function plaque(f) {
    const [x, y] = onFace(f, 0, 0.03);
    cb.add(new THREE.BoxGeometry(0.9, 0.6, 0.06), mt.stone, m4(x, 1.6, y, f.rot), f.cen, { worldUV: true });
    cb.add(new THREE.BoxGeometry(0.7, 0.42, 0.03), mt.gold, m4(x + f.nx * 0.035, 1.6, y + f.ny * 0.035, f.rot), f.cen);
  }

  function rubbleAt(f) {
    for (let i = 0; i < 5 + Math.floor(rnd() * 4); i++) {
      const [x, y] = onFace(f, (rnd() - 0.5) * 1.6, 0.05 + rnd() * 0.3);
      const r = 0.07 + rnd() * 0.16;
      cb.add(jitterGeo(new THREE.DodecahedronGeometry(r, 0), r * 0.4, rnd), mt.rock, m4(x, r * 0.6, y, rnd() * 6, 1, 0.7, 1, rnd(), rnd()), null, { worldUV: true });
    }
  }

  function candleCluster(x, y) {
    const n = 3 + Math.floor(rnd() * 3);
    cb.add(new THREE.CylinderGeometry(0.28, 0.3, 0.02, 12), mt.wax, m4(x, 0.01, y, 0, 1, 1, 1));
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28; const d = rnd() * 0.18; const h = 0.1 + rnd() * 0.3;
      const cx = x + Math.cos(a) * d; const cy = y + Math.sin(a) * d;
      cb.add(new THREE.CylinderGeometry(0.035, 0.042, h, 6), mt.wax, m4(cx, h / 2, cy));
      if (i < 2 || quality === 'high') addFlame(cx, h + 0.04, cy, 0.2);
    }
    lights.push({ x, y, h: 0.6, color: 0xffb060, weak: true });
  }

  function addFlame(x, y, z, s) {
    const fl = P.flame(0xffc070, s); fl.position.set(x, y, z); root.add(fl); anim.push(fl);
  }

  function cobweb(c, h) {
    const g = new THREE.BufferGeometry();
    const L = 1.0 + rnd() * 0.6;
    const ax = c.x - c.dx * L; const az = c.y;
    const bx = c.x; const bz = c.y - c.dy * L;
    const top = h - 0.15; const low = h - 0.4 - L * 0.9;
    g.setAttribute('position', new THREE.Float32BufferAttribute([ax, top, az, bx, top, bz, c.x - c.dx * 0.02, low, c.y - c.dy * 0.02], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0.02], 2));
    g.computeVertexNormals();
    cb.add(g, mt.web, null, c.cen);
  }

  function stalagmites(x, y, cen, n, hmax) {
    for (let i = 0; i < n; i++) {
      const h = (0.35 + rnd() * 0.65) * hmax * (i ? 0.7 : 1); const r = h * (0.18 + rnd() * 0.1);
      const g = jitterGeo(new THREE.ConeGeometry(r, h, 7, 3), r * 0.35, rnd);
      const a = rnd() * 6.28; const d = i ? 0.15 + rnd() * 0.3 : 0;
      cb.add(g, mt.rock, m4(x + Math.cos(a) * d, h / 2 - 0.03, y + Math.sin(a) * d, rnd() * 6, 1, 1, 1, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15), cen, { worldUV: true, uvScale: 1 });
    }
  }

  function boulders(f) {
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
      const r = 0.25 + rnd() * 0.35;
      const [x, y] = onFace(f, (rnd() - 0.5) * 1.4, r * 0.3);
      cb.add(jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.35, rnd), mt.rock, m4(x, r * 0.55, y, rnd() * 6, 1, 0.75, 1), f.cen, { worldUV: true, uvScale: 1 });
    }
  }

  function crystals(f) {
    const [x, y] = onFace(f, (rnd() - 0.5) * 0.8, 0.1);
    const mat = rnd() < 0.5 ? mt.crystal : mt.crystal2;
    const base = 0.3 + rnd() * 1.4;
    for (let i = 0; i < 4 + Math.floor(rnd() * 3); i++) {
      const h = 0.3 + rnd() * 0.6; const r = 0.05 + rnd() * 0.07;
      const g = new THREE.ConeGeometry(r, h, 5); g.translate(0, h / 2, 0);
      const tilt = 0.4 + rnd() * 0.7; const spin = (rnd() - 0.5) * 1.6;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, f.rot + spin, 0, 'YXZ'));
      const mm = new THREE.Matrix4().compose(new THREE.Vector3(x - f.nx * 0.08, base + (rnd() - 0.5) * 0.3, y - f.ny * 0.08), q, new THREE.Vector3(1, 1, 1));
      cb.add(g, mat, mm, f.cen);
    }
    lights.push({ x: x + f.nx * 0.6, y: y + f.ny * 0.6, h: base + 0.3, color: mat === mt.crystal ? 0x8a6aff : 0x40e0d0, weak: true });
  }

  function fungus(f) {
    for (let i = 0; i < 3 + Math.floor(rnd() * 4); i++) {
      const r = 0.08 + rnd() * 0.14;
      const [x, y] = onFace(f, (rnd() - 0.5) * 1.4, 0);
      const g = new THREE.CylinderGeometry(r, r * 0.8, 0.04, 10, 1, false, -Math.PI / 2, Math.PI);
      cb.add(g, mt.fungus, m4(x, 0.3 + rnd() * 1.8, y, f.rot), f.cen);
    }
    const [x, y] = onFace(f, 0, 0.3);
    lights.push({ x, y, h: 1, color: 0x30e0c0, weak: true });
  }

  function shoring(f) {
    for (const s of [-0.75, 0.75]) { const [x, y] = onFace(f, s, 0.12); cb.add(new THREE.BoxGeometry(0.2, wallH - 0.2, 0.2), mt.wood, m4(x, (wallH - 0.2) / 2, y, f.rot), f.cen, { worldUV: true }); }
    const [x, y] = onFace(f, 0, 0.14);
    cb.add(new THREE.BoxGeometry(1.9, 0.22, 0.24), mt.wood, m4(x, wallH - 0.35, y, f.rot), f.cen, { worldUV: true });
    if (rnd() < 0.6) { // lantern on the beam
      const [lx, ly] = onFace(f, 0.4, 0.3);
      cb.add(new THREE.BoxGeometry(0.16, 0.22, 0.16), flat(0xffd890, { emissive: 0xffa040, emissiveIntensity: 2.5 }), m4(lx, wallH - 0.62, ly), f.cen);
      lights.push({ x: lx + f.nx * 0.3, y: ly + f.ny * 0.3, h: 2.3, color: 0xffb060 });
    }
  }

  function spikes(x, y, cen, rot, n) {
    for (let i = 0; i < n; i++) {
      const h = 0.5 + rnd() * 1.3; const r = 0.06 + rnd() * 0.1;
      const g = jitterGeo(new THREE.ConeGeometry(r, h, 5, 2), r * 0.3, rnd); g.translate(0, h / 2, 0);
      const a = rnd() * 6.28; const d = rnd() * 0.3;
      cb.add(g, mt.obsidian, m4(x + Math.cos(a) * d, -0.02, y + Math.sin(a) * d, rot + (rnd() - 0.5), 1, 1, 1, (rnd() - 0.2) * 0.5, (rnd() - 0.5) * 0.5), cen);
      if (i === 0 && rnd() < 0.4) cb.add(new THREE.SphereGeometry(0.11, 8, 6), mt.bone, m4(x, h * 0.72, y, rot, 1, 0.9, 1.15), cen);
    }
  }

  function lavaFall(f) {
    const [x, y] = onFace(f, (rnd() - 0.5) * 0.6, 0.03);
    const w = 0.5 + rnd() * 0.4;
    cb.add(new THREE.PlaneGeometry(w, wallH), mt.fall, m4(x, wallH / 2, y, f.rot), f.cen);
    cb.add(decalGeo(CELLS.lava), mt.lava, m4(x + f.nx * 0.5, 0.016, y + f.ny * 0.5, rnd() * 6, 1.8));
    cb.add(poolGeo(), mt.pool, m4(x + f.nx * 0.6, 0.013, y + f.ny * 0.6, 0, 3.2), null, { colors: [0.55, 0.16, 0.03] });
    lights.push({ x: x + f.nx * 0.7, y: y + f.ny * 0.7, h: 1.2, color: 0xff5010, weak: true });
    if (!anim.some((a) => a.userData?.lavaFall)) { const o = new THREE.Object3D(); o.userData.lavaFall = true; o.userData.tick = (t) => { mt.fallTex.offset.y = (t * 0.35) % 1; }; anim.push(o); }
  }

  function firePillar(f) {
    const [x, y] = onFace(f, 0, 0.3);
    cb.add(new THREE.CylinderGeometry(0.22, 0.28, 1.3, 8), mt.stone, m4(x, 0.65, y), f.cen, { worldUV: true });
    cb.add(new THREE.CylinderGeometry(0.34, 0.2, 0.22, 10), mt.iron, m4(x, 1.4, y), f.cen);
    cb.add(new THREE.SphereGeometry(0.16, 8, 6), mt.bone, m4(x + f.nx * 0.2, 1.05, y + f.ny * 0.2, f.rot, 1, 0.95, 1.1), f.cen);
    cb.add(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 10), glow(0xff5a1a), m4(x, 1.5, y), f.cen);
    const fl = P.flame(0xff6a20, 1.1); fl.position.set(x, 1.75, y); root.add(fl); anim.push(fl);
    lights.push({ x, y, h: 1.9, color: 0xff6a20, flame: fl });
  }
}

// A few puddles, moss and cracks on the village cobbles to break up the big plaza.
export function dressTownGround(map, root, quality) {
  const cb = new CutBatcher();
  const rng = new RNG(hashSeed('town-decals')); const rnd = () => rng.next();
  const mt = mats('town');
  const puddle = mt.puddle.clone(); puddle.color.set(0x3a4450); puddle.opacity = 0.5;
  let k = 0;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!map.ground[ty * map.w + tx] || map.get(tx, ty) !== T.FLOOR) continue;
    const r = rnd();
    if (r > (quality === 'low' ? 0.08 : 0.16)) continue;
    const kind = r < 0.04 ? 'puddle' : r < 0.1 ? 'moss' : r < 0.13 ? 'crack' : 'stain';
    const x = tx * TILE + 1 + (rnd() - 0.5); const y = ty * TILE + 1 + (rnd() - 0.5);
    const mat = kind === 'puddle' ? puddle : mt.decal;
    const size = kind === 'puddle' ? 1.4 + rnd() * 1.6 : 1 + rnd();
    cb.add(decalGeo(CELLS[kind]), mat, m4(x, 0.014 + (k++ % 5) * 0.001, y, rnd() * 6.28, size, 1, kind === 'stain' ? size * 0.6 : size));
  }
  cb.build(root, { shadows: false });
}
