// Map generation and collision, shared by the server (gameplay) and the browser (rendering).
// World units are meters; one tile is TILE meters square. Tile (tx, ty) covers
// x in [tx*TILE, (tx+1)*TILE), z in [ty*TILE, (ty+1)*TILE). Gameplay uses (x, y) for the ground plane.
import { RNG, hashSeed } from './rng.js';

export const TILE = 2;
export const T = { VOID: 0, FLOOR: 1, WALL: 2, PILLAR: 3, BLOCK: 4 };
export const BOSS_EVERY = 5;

export const THEMES = ['crypt', 'cavern', 'infernal'];
export function themeFor(floor) { return THEMES[Math.floor((floor - 1) / 5) % THEMES.length]; }
export const isBossFloor = (floor) => floor % BOSS_EVERY === 0;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const toWorld = (t) => t * TILE + TILE / 2;
export const toTile = (w) => Math.floor(w / TILE);

export class GameMap {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.ground = new Uint8Array(w * h); // render hint (town: 0 grass, 1 cobble)
    this.props = []; // decor + interactables: { type, x, y, rot, ... } (world meters)
    this.lights = []; // { x, y, h, color }
    this.spawns = []; // { type, x, y, elite, boss }
    this.breakables = []; // { type, x, y }
    this.chests = []; // { x, y, rot }
    this.start = { x: 0, y: 0 };
    this.exit = null; // stairs down { x, y }
    this.entry = null; // stairs up / town gate { x, y }
    this.npcs = []; // { id, type, name, x, y, rot }
    this.kind = 'dungeon';
    this.theme = 'crypt';
  }
  get(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? T.VOID : this.tiles[ty * this.w + tx]; }
  set(tx, ty, v) { if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.tiles[ty * this.w + tx] = v; }
  walkable(tx, ty) { return this.get(tx, ty) === T.FLOOR; }
  walkableAt(x, y) { return this.walkable(toTile(x), toTile(y)); }
}

// ---------------------------------------------------------------- collision
// Move a circle by (dx, dy), sliding along walls. Returns the new position.
export function moveCircle(map, x, y, dx, dy, r) {
  // Sub-step so fast movers never tunnel through a tile.
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (TILE * 0.4)));
  const sx = dx / steps; const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    x += sx; ({ x, y } = resolve(map, x, y, r));
    y += sy; ({ x, y } = resolve(map, x, y, r));
  }
  return { x, y };
}

function resolve(map, x, y, r) {
  const tx0 = toTile(x - r); const tx1 = toTile(x + r);
  const ty0 = toTile(y - r); const ty1 = toTile(y + r);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.walkable(tx, ty)) continue;
      const minX = tx * TILE; const minY = ty * TILE;
      const cx = clamp(x, minX, minX + TILE); const cy = clamp(y, minY, minY + TILE);
      let ox = x - cx; let oy = y - cy;
      const d2 = ox * ox + oy * oy;
      if (d2 >= r * r) continue;
      if (d2 < 1e-9) { // center inside the tile: push out the shortest way
        const l = x - minX; const rr = minX + TILE - x; const t = y - minY; const b = minY + TILE - y;
        const m = Math.min(l, rr, t, b);
        if (m === l) x = minX - r; else if (m === rr) x = minX + TILE + r; else if (m === t) y = minY - r; else y = minY + TILE + r;
        continue;
      }
      const d = Math.sqrt(d2);
      ox /= d; oy /= d;
      x = cx + ox * r; y = cy + oy * r;
    }
  }
  return { x, y };
}

// Line of sight between two world points (tile DDA).
export function lineOfSight(map, x0, y0, x1, y1) {
  const dx = x1 - x0; const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!map.walkableAt(x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

// Breadth-first distance field (in tiles) from a set of world points; used for monster pathing.
export function distanceField(map, sources, maxDist = 40) {
  const { w, h } = map;
  const dist = new Int16Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let head = 0; let tail = 0;
  for (const s of sources) {
    const tx = toTile(s.x); const ty = toTile(s.y);
    if (!map.walkable(tx, ty)) continue;
    const i = ty * w + tx;
    if (dist[i] === 0) continue;
    dist[i] = 0; q[tail++] = i;
  }
  while (head < tail) {
    const i = q[head++];
    const d = dist[i];
    if (d >= maxDist) continue;
    const tx = i % w; const ty = (i - tx) / w;
    for (let k = 0; k < 4; k++) {
      const nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = ty + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!map.walkable(nx, ny)) continue;
      const j = ny * w + nx;
      if (dist[j] !== -1) continue;
      dist[j] = d + 1; q[tail++] = j;
    }
  }
  return dist;
}

// ---------------------------------------------------------------- dungeon
// Monster tables by theme. Weights for regular packs.
const PACKS = {
  crypt: [['skeleton', 5], ['rat', 3], ['archer', 2], ['spider', 1]],
  cavern: [['goblin', 5], ['spider', 4], ['archer', 2], ['skeleton', 1]],
  infernal: [['imp', 5], ['skeleton', 2], ['goblin', 2], ['archer', 2]],
};
const BOSSES = { crypt: 'ogre', cavern: 'broodmother', infernal: 'ogre' };

export function generateDungeon(seed, floor) {
  const rng = new RNG(hashSeed('dungeon', seed, floor));
  const size = clamp(44 + floor * 2, 46, 72);
  const map = new GameMap(size, size);
  map.kind = 'dungeon';
  map.floor = floor;
  map.theme = themeFor(floor);
  const boss = isBossFloor(floor);

  // 1) rooms
  const rooms = [];
  const target = clamp(7 + Math.floor(floor / 2), 7, 15);
  const fits = (r) => r.x >= 2 && r.y >= 2 && r.x + r.w < size - 2 && r.y + r.h < size - 2
    && rooms.every((o) => r.x + r.w + 2 <= o.x || o.x + o.w + 2 <= r.x || r.y + r.h + 2 <= o.y || o.y + o.h + 2 <= r.y);
  if (boss) {
    for (let i = 0; i < 200; i++) {
      const r = { w: 13, h: 13, x: rng.int(2, size - 16), y: rng.int(2, size - 16), boss: true };
      if (fits(r)) { rooms.push(r); break; }
    }
  }
  for (let tries = 0; tries < 600 && rooms.length < target; tries++) {
    const r = { w: rng.int(5, 11), h: rng.int(5, 10), x: 0, y: 0 };
    r.x = rng.int(2, size - r.w - 3); r.y = rng.int(2, size - r.h - 3);
    if (fits(r)) rooms.push(r);
  }
  for (const r of rooms) {
    r.cx = r.x + Math.floor(r.w / 2); r.cy = r.y + Math.floor(r.h / 2);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, T.FLOOR);
  }

  // 2) connect: minimum spanning tree + a few loops
  const edges = [];
  const inTree = new Set([0]);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < rooms.length; b++) {
        if (inTree.has(b)) continue;
        const d = Math.abs(rooms[a].cx - rooms[b].cx) + Math.abs(rooms[a].cy - rooms[b].cy);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    inTree.add(best.b); edges.push([best.a, best.b]);
  }
  for (let i = 0; i < rooms.length; i++) {
    if (!rng.chance(0.22)) continue;
    const j = rng.int(0, rooms.length - 1);
    if (j !== i && !(boss && (rooms[i].boss || rooms[j].boss))) edges.push([i, j]);
  }
  const carve = (x, y) => { if (map.get(x, y) !== T.FLOOR) map.set(x, y, T.FLOOR); };
  for (const [ia, ib] of edges) {
    const a = rooms[ia]; const b = rooms[ib];
    const hFirst = rng.chance(0.5);
    let x = a.cx; let y = a.cy;
    const stepX = () => { while (x !== b.cx) { carve(x, y); carve(x, y + 1); x += Math.sign(b.cx - x); } };
    const stepY = () => { while (y !== b.cy) { carve(x, y); carve(x + 1, y); y += Math.sign(b.cy - y); } };
    if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    carve(x, y); carve(x + 1, y); carve(x, y + 1); carve(x + 1, y + 1);
  }

  // 3) pillars in some big rooms (single blocking tiles with space around them)
  for (const r of rooms) {
    if (r.boss) {
      for (const [px, py] of [[3, 3], [r.w - 4, 3], [3, r.h - 4], [r.w - 4, r.h - 4]]) map.set(r.x + px, r.y + py, T.PILLAR);
      continue;
    }
    if (r.w < 8 || r.h < 8 || !rng.chance(0.45)) continue;
    for (let y = r.y + 2; y < r.y + r.h - 2; y += 3) {
      for (let x = r.x + 2; x < r.x + r.w - 2; x += 3) {
        if (Math.abs(x - r.cx) <= 1 && Math.abs(y - r.cy) <= 1) continue;
        map.set(x, y, T.PILLAR);
      }
    }
  }

  // 4) walls around every floor tile
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (map.get(x, y) !== T.VOID) continue;
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (map.get(x + ox, y + oy) === T.FLOOR) { near = true; break; }
      if (near) map.set(x, y, T.WALL);
    }
  }

  // 5) start + exit: exit is the room farthest from the start (or the boss room)
  let startRoom = rooms[boss ? 1 : 0];
  let exitRoom;
  if (boss) {
    exitRoom = rooms[0];
    const d = distanceField(map, [{ x: toWorld(exitRoom.cx), y: toWorld(exitRoom.cy) }], 999);
    startRoom = rooms.slice(1).reduce((best, r) => (d[r.cy * size + r.cx] > d[best.cy * size + best.cx] ? r : best), rooms[1]);
  } else {
    const d = distanceField(map, [{ x: toWorld(startRoom.cx), y: toWorld(startRoom.cy) }], 999);
    exitRoom = rooms.reduce((best, r) => (d[r.cy * size + r.cx] > d[best.cy * size + best.cx] ? r : best), rooms[1] || rooms[0]);
  }
  // Make sure the stair tiles are open (pillars can't sit on them).
  for (const r of [startRoom, exitRoom]) for (let y = r.cy - 1; y <= r.cy + 1; y++) for (let x = r.cx - 1; x <= r.cx + 1; x++) if (map.get(x, y) === T.PILLAR) map.set(x, y, T.FLOOR);
  map.entry = { x: toWorld(startRoom.cx), y: toWorld(startRoom.cy) };
  map.start = { x: toWorld(startRoom.cx) + TILE, y: toWorld(startRoom.cy) + TILE };
  map.exit = { x: toWorld(exitRoom.cx), y: toWorld(exitRoom.cy) };
  map.props.push({ type: 'stairsUp', x: map.entry.x, y: map.entry.y, rot: 0 });
  map.props.push({ type: 'stairsDown', x: map.exit.x, y: map.exit.y, rot: 0 });
  map.rooms = rooms;

  // 6) torches on walls that face a room, plus decor
  const usedWall = new Set();
  for (const r of rooms) {
    const spots = [];
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 1) { spots.push([x, r.y - 1, 0, 1]); spots.push([x, r.y + r.h, 0, -1]); }
    for (let y = r.y + 1; y < r.y + r.h - 1; y += 1) { spots.push([r.x - 1, y, 1, 0]); spots.push([r.x + r.w, y, -1, 0]); }
    rng.shuffle(spots);
    let placed = 0;
    const want = r.boss ? 6 : clamp(Math.round((r.w + r.h) / 6), 1, 4);
    for (const [wx, wy, nx, ny] of spots) {
      if (placed >= want) break;
      if (map.get(wx, wy) !== T.WALL || map.get(wx + nx, wy + ny) !== T.FLOOR) continue;
      const key = `${wx},${wy}`;
      if ([...usedWall].some((k) => { const [a, b] = k.split(',').map(Number); return Math.abs(a - wx) + Math.abs(b - wy) < 3; })) continue;
      usedWall.add(key);
      const x = toWorld(wx) + nx * (TILE / 2 + 0.05); const y = toWorld(wy) + ny * (TILE / 2 + 0.05);
      const rot = Math.atan2(nx, ny);
      map.props.push({ type: rng.chance(0.82) ? 'torch' : 'banner', x, y, rot });
      if (map.props[map.props.length - 1].type === 'torch') map.lights.push({ x: x + nx * 0.4, y: y + ny * 0.4, h: 2.3 });
      placed++;
    }
  }

  // Floor decor: bones, rubble, cobwebs. Rendering only.
  const floorTiles = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (map.get(x, y) === T.FLOOR) floorTiles.push([x, y]);
  const nearStairs = (x, y) => Math.hypot(x - map.entry.x, y - map.entry.y) < 4 || Math.hypot(x - map.exit.x, y - map.exit.y) < 4;
  const decorCount = Math.floor(floorTiles.length * 0.05);
  const decorTypes = map.theme === 'cavern' ? [['rubble', 4], ['mushrooms', 3], ['bones', 2], ['crystal', 1]]
    : map.theme === 'infernal' ? [['rubble', 3], ['bones', 4], ['brazier', 1], ['skullpile', 2]]
      : [['bones', 4], ['rubble', 3], ['skullpile', 1], ['candles', 2]];
  for (let i = 0; i < decorCount; i++) {
    const [tx, ty] = rng.pick(floorTiles);
    const x = toWorld(tx) + rng.float(-0.6, 0.6); const y = toWorld(ty) + rng.float(-0.6, 0.6);
    if (nearStairs(x, y)) continue;
    const type = rng.weighted(decorTypes);
    map.props.push({ type, x, y, rot: rng.float(0, Math.PI * 2), s: rng.float(0.8, 1.2) });
    if (type === 'brazier') map.lights.push({ x, y, h: 1.4 });
  }

  // 7) breakables in room corners, chests against walls
  const corners = [];
  for (const r of rooms) {
    if (r === startRoom || r.boss) continue;
    corners.push([r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]);
  }
  rng.shuffle(corners);
  const clusters = Math.min(corners.length, 3 + Math.floor(rooms.length / 2));
  for (let i = 0; i < clusters; i++) {
    const [cx, cy] = corners[i];
    if (map.get(cx, cy) !== T.FLOOR) continue;
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const x = toWorld(cx) + rng.float(-0.4, 0.4) + (k % 2) * 0.9 * (cx > size / 2 ? -1 : 1);
      const y = toWorld(cy) + rng.float(-0.4, 0.4) + Math.floor(k / 2) * 0.9 * (cy > size / 2 ? -1 : 1);
      if (map.walkableAt(x, y)) map.breakables.push({ type: rng.chance(0.55) ? 'barrel' : 'crate', x, y });
    }
  }
  const chestRooms = rng.shuffle(rooms.filter((r) => r !== startRoom && !r.boss)).slice(0, rng.int(1, 2));
  for (const r of chestRooms) {
    const side = rng.int(0, 3);
    const tx = side < 2 ? rng.int(r.x + 1, r.x + r.w - 2) : side === 2 ? r.x : r.x + r.w - 1;
    const ty = side >= 2 ? rng.int(r.y + 1, r.y + r.h - 2) : side === 0 ? r.y : r.y + r.h - 1;
    if (map.get(tx, ty) !== T.FLOOR) continue;
    const rot = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
    map.chests.push({ x: toWorld(tx), y: toWorld(ty), rot });
  }
  if (boss) {
    const r = exitRoom;
    map.chests.push({ x: toWorld(r.cx) + TILE * 2, y: toWorld(r.cy) - TILE * 3, rot: 0, boss: true });
  }

  // 8) monster packs
  const table = PACKS[map.theme];
  const density = (floor <= 2 ? 0.7 : 0.9) + Math.min(0.8, floor * 0.04);
  for (const r of rooms) {
    if (r === startRoom) continue;
    if (r.boss) {
      map.spawns.push({ type: BOSSES[map.theme], x: toWorld(r.cx), y: toWorld(r.cy) - TILE * 2, boss: true });
      continue;
    }
    const packs = Math.max(1, Math.round((r.w * r.h) / 30 * density));
    for (let p = 0; p < packs; p++) {
      const type = rng.weighted(table);
      const elite = rng.chance(0.07 + Math.min(0.1, floor * 0.006));
      const n = elite ? 1 : type === 'rat' || type === 'goblin' || type === 'imp' ? rng.int(floor < 3 ? 2 : 3, floor < 3 ? 4 : 5) : type === 'archer' ? rng.int(1, 2) : rng.int(2, 4);
      const px = rng.int(r.x + 1, r.x + r.w - 2); const py = rng.int(r.y + 1, r.y + r.h - 2);
      for (let k = 0; k < n; k++) {
        const x = toWorld(px) + rng.float(-1.5, 1.5); const y = toWorld(py) + rng.float(-1.5, 1.5);
        if (!map.walkableAt(x, y)) continue;
        map.spawns.push({ type, x, y, elite: elite && k === 0 });
      }
      // Elites come with a few minions of the same kind.
      if (elite) {
        for (let k = 0; k < 3; k++) {
          const x = toWorld(px) + rng.float(-2, 2); const y = toWorld(py) + rng.float(-2, 2);
          if (map.walkableAt(x, y)) map.spawns.push({ type, x, y });
        }
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------- town
// Hand-made hub. Legend:
//  # tree line (blocks)   . grass   , cobblestone   H house   F fountain   T tree   W well
//  D dungeon entrance     M merchant   S smith   P player spawn   L lamp post (on cobble)
//  A auctioneer   C artificer   B banker   O mailbox   X duel arena
const TOWN = [
  '##################################',
  '##TT..TT....######....T..TT..TT###',
  '#T..........##DD##...........T..##',
  '#..HHHHH....#,,,,#....HHHHHH....T#',
  '#..HHHHH....,,,,,,....HHHHHH.....#',
  '#..HHHHH...,,,L,,,,...HHHHHH..T..#',
  '#T..,,B...,,,,,,,,,,..,,,........#',
  '#...,,,,,,,,,,,,,,,,,,,,,,.......#',
  '#....L,,,,,,,,FFF,,,,,,L,,..T....#',
  '#.....,,,M,,,,FFF,,,,S,,,,.......#',
  '#T....,,,,,,,,FFF,,,,,,,,,....T..#',
  '#.....,,,,,,,,,,,,,,,,,,,,.......#',
  '#..HHHH,,,,,,,,P,,O,,,,,HHHHH....#',
  '#..HHHH..A,,,,,,,,,,C,..HHHHH..T.#',
  '#..HHHH...L,,,,,,,,,L...HHHHH....#',
  '#T.........,,,,,,,,,.........T...#',
  '#....TT.....,,,,,,,.....TT.......#',
  '#...........,,,,,,,..........T...#',
  '##T...T....T,,,,,,,T....T.......##',
  '#...........,,,,,,,..............#',
  '#...........,,,,,,,...T..........#',
  '#......T....,,,,,,,...........T..#',
  '#...........,,,,,,,,.............#',
  '#...........,,,,,,,,,..T.........#',
  '#.......T...,,,,,,,,,..........T.#',
  '#...........,,,,X,,,,............#',
  '#T..........,,,,,,,,,...T........#',
  '#........T..,,,,,,,,,...........T#',
  '#............,,,,,,,.............#',
  '#.T...........,,,,,......T.......#',
  '#.........T......................#',
  '##################################',
];

export function generateTown() {
  const h = TOWN.length; const w = TOWN[0].length;
  const map = new GameMap(w, h);
  map.kind = 'town';
  map.theme = 'town';
  map.floor = 0;
  const seen = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = TOWN[y][x];
      const i = y * w + x;
      const wx = toWorld(x); const wy = toWorld(y);
      map.ground[i] = ',DMSPLFCAXBO'.includes(c) ? 1 : 0;
      if (c === '#') map.tiles[i] = T.WALL;
      else if (c === 'H' || c === 'F' || c === 'T' || c === 'W') map.tiles[i] = T.BLOCK;
      else map.tiles[i] = T.FLOOR;
      if (c === 'T') map.props.push({ type: 'tree', x: wx, y: wy, rot: (x * 7 + y * 13) % 6, s: 0.9 + ((x * 31 + y * 17) % 5) * 0.08 });
      if (c === 'L') { map.tiles[i] = T.FLOOR; map.props.push({ type: 'lamppost', x: wx, y: wy, rot: 0 }); map.lights.push({ x: wx, y: wy, h: 3.2 }); }
      if (c === 'P') map.start = { x: wx, y: wy };
      if (c === 'M') map.npcs.push({ id: 'merchant', type: 'merchant', name: 'Brannoc the Trader', x: wx, y: wy, rot: Math.PI / 2 });
      if (c === 'S') map.npcs.push({ id: 'smith', type: 'smith', name: 'Hilda the Smith', x: wx, y: wy, rot: -Math.PI / 2 });
      if (c === 'X') map.arena = { x: wx, y: wy, r: 4.4 * TILE };
      if (c === 'A') map.npcs.push({ id: 'auctioneer', type: 'auctioneer', name: 'Vesna the Broker', x: wx, y: wy, rot: Math.PI });
      if (c === 'B') map.npcs.push({ id: 'banker', type: 'banker', name: 'Odo the Banker', x: wx, y: wy, rot: 0 });
      if (c === 'O') map.npcs.push({ id: 'mailbox', type: 'mailbox', name: 'Mailbox', x: wx, y: wy, rot: 0 });
      if (c === 'C') map.npcs.push({ id: 'crafter', type: 'crafter', name: 'Orlen the Artificer', x: wx, y: wy, rot: Math.PI });
      // Rectangular blocks: houses and the fountain become single props with a footprint.
      if ((c === 'H' || c === 'F') && !seen.has(i)) {
        let x2 = x; while (TOWN[y][x2 + 1] === c) x2++;
        let y2 = y; while (y2 + 1 < h && TOWN[y2 + 1][x] === c) y2++;
        for (let yy = y; yy <= y2; yy++) for (let xx = x; xx <= x2; xx++) seen.add(yy * w + xx);
        const bw = (x2 - x + 1) * TILE; const bh = (y2 - y + 1) * TILE;
        const cx = x * TILE + bw / 2; const cy = y * TILE + bh / 2;
        // Houses face the nearest street (toward the middle of town).
        const rot = cy < (h * TILE) / 2 ? 0 : Math.PI;
        map.props.push({ type: c === 'H' ? 'house' : 'fountain', x: cx, y: cy, w: bw, d: bh, rot, variant: (x + y) % 3 });
        if (c === 'F') map.lights.push({ x: cx, y: cy, h: 3, color: 0x88aaff });
      }
    }
  }
  // Duel arena: a sanded ring with posts and four braziers (drawn by the renderer).
  if (map.arena) {
    const A = map.arena;
    map.props.push({ type: 'arena', x: A.x, y: A.y, r: A.r });
    for (const a of [0.785, 2.356, 3.927, 5.498]) {
      const bx = A.x + Math.cos(a) * (A.r + 0.9); const by = A.y + Math.sin(a) * (A.r + 0.9);
      map.props.push({ type: 'brazier', x: bx, y: by, rot: 0 });
    }
  }
  // Dungeon entrance: the two D tiles form the stair mouth; walk into it to descend.
  let dx = 0; let dy = 0; let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (TOWN[y][x] === 'D') { dx += toWorld(x); dy += toWorld(y); n++; }
  map.exit = { x: dx / n, y: dy / n };
  map.props.push({ type: 'dungeonGate', x: map.exit.x, y: map.exit.y - TILE * 0.5, rot: 0 });
  map.entry = { x: map.start.x, y: map.start.y };
  return map;
}

export function buildMap(zone) {
  return zone.kind === 'town' ? generateTown() : generateDungeon(zone.seed, zone.floor);
}
