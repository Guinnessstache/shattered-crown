// Procedural textures (albedo + normal map) painted at load time, so the game ships tiny
// and every theme gets matching stone, rock, wood and grass.
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
function makeNoise(seed) {
  const p = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  // Tileable gradient noise with period `per`.
  return (x, y, per = 256) => {
    const X = Math.floor(x); const Y = Math.floor(y);
    const xf = x - X; const yf = y - Y;
    const xi = ((X % per) + per) % per; const yi = ((Y % per) + per) % per;
    const xi1 = (xi + 1) % per; const yi1 = (yi + 1) % per;
    const u = fade(xf); const v = fade(yf);
    const aa = p[p[xi] + yi]; const ab = p[p[xi] + yi1]; const ba = p[p[xi1] + yi]; const bb = p[p[xi1] + yi1];
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return x1 * (1 - v) + x2 * v; // ~[-1, 1]
  };
}

function fbm(noise, x, y, oct, per) {
  let a = 0.5; let f = 1; let sum = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise(x * f, y * f, per * f); a *= 0.5; f *= 2; }
  return sum;
}

// Voronoi-ish cells for flagstones / cobbles (tileable).
function cells(size, count, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rnd() * size, rnd() * size, rnd()]);
  return (x, y) => {
    let d1 = 1e9; let d2 = 1e9; let id = 0;
    for (const [px, py, r] of pts) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const dx = x - (px + ox * size); const dy = y - (py + oy * size);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; id = r; } else if (d < d2) d2 = d;
      }
    }
    return { edge: Math.sqrt(d2) - Math.sqrt(d1), id };
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// ---------------------------------------------------------------- painters
// Each painter returns { color: [r,g,b] 0..1, h: height 0..1 } for a pixel.
const PAINTERS = {
  flagstone: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, o.cells || 14, o.seed + 7);
    return (x, y) => {
      const v = c(x, y);
      const g = fbm(n, x / 18, y / 18, 4, o.size / 18);
      const grit = n(x / 2.3, y / 2.3, o.size / 2.3) * 0.5;
      const groove = clamp01(v.edge / 5);
      const base = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g * 0.9 + (v.id - 0.5) * 0.5));
      const shade = (0.55 + 0.45 * groove) * (0.92 + grit * 0.16);
      const moss = o.moss ? clamp01(fbm(n, x / 30 + 9, y / 30, 3, o.size / 30) * 2 - 0.25) * (1 - groove) * 0.4 : 0;
      const col = mix3(base.map((k) => k * shade), hex(o.moss || 0x3a4a22), moss);
      return { color: col, h: groove * 0.8 + g * 0.15 + grit * 0.05 };
    };
  },
  brick: (o) => {
    const n = makeNoise(o.seed);
    const rows = o.rows || 8; const bw = o.size / (o.cols || 4); const bh = o.size / rows;
    return (x, y) => {
      const row = Math.floor(y / bh);
      const off = (row % 2) * bw * 0.5;
      const bx = ((x + off) % bw + bw) % bw; const by = y % bh;
      const brickId = Math.floor((x + off) / bw) * 17 + row * 31;
      const mort = Math.min(bx, bw - bx, by, bh - by);
      const groove = clamp01((mort - 1.2) / 3);
      const g = fbm(n, x / 14, y / 14, 4, o.size / 14);
      const tint = ((Math.sin(brickId * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const base = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g + (tint - 0.5) * 0.6));
      const col = groove < 0.05 ? hex(o.mortar || 0x1a1612) : base.map((k) => k * (0.75 + 0.25 * groove) * (0.9 + g * 0.2));
      return { color: col, h: groove * 0.85 + g * 0.15 };
    };
  },
  rock: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 26, y / 26, 5, o.size / 26);
      const r = Math.abs(fbm(n, x / 12 + 40, y / 12, 3, o.size / 12));
      const h = clamp01(0.5 + g * 0.8 - r * 0.6);
      const col = mix3(hex(o.a), hex(o.b), h).map((k) => k * (0.7 + 0.5 * h));
      if (o.glow) { const v = clamp01(1 - r * 9); col[0] += v * 0.7; col[1] += v * 0.18; }
      return { color: col, h };
    };
  },
  dirt: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 22, y / 22, 5, o.size / 22);
      const pebble = clamp01(n(x / 3, y / 3, o.size / 3) * 3 - 1.4);
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g)).map((k) => k * (1 + pebble * 0.25));
      return { color: col, h: clamp01(0.5 + g * 0.5 + pebble * 0.4) };
    };
  },
  grass: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 40, y / 40, 4, o.size / 40);
      const blade = n(x / 1.5, y / 4, o.size / 1.5) * 0.5 + 0.5;
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.45 + g * 1.1)).map((k) => k * (0.8 + blade * 0.35));
      return { color: col, h: blade * 0.6 + g * 0.2 };
    };
  },
  cobble: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, o.cells || 90, o.seed + 3);
    return (x, y) => {
      const v = c(x, y);
      const groove = clamp01(v.edge / 4);
      const dome = Math.sqrt(groove);
      const g = fbm(n, x / 10, y / 10, 3, o.size / 10);
      const base = mix3(hex(o.a), hex(o.b), clamp01(v.id + g * 0.6));
      const col = groove < 0.12 ? hex(0x2a241c).map((k) => k * (0.9 + g)) : base.map((k) => k * (0.6 + 0.4 * dome));
      return { color: col, h: dome };
    };
  },
  planks: (o) => {
    const n = makeNoise(o.seed); const pw = o.size / (o.n || 6);
    return (x, y) => {
      const i = Math.floor(x / pw); const px = x % pw;
      const edge = clamp01(Math.min(px, pw - px) / 2.5);
      const grain = n(x / 2, (y + i * 37) / 22, o.size / 2) * 0.5 + fbm(n, x / 8, y / 40, 3, o.size / 8) * 0.5;
      const tint = ((Math.sin(i * 78.233) * 43758.5453) % 1 + 1) % 1;
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + grain + (tint - 0.5) * 0.5)).map((k) => k * (0.55 + 0.45 * edge));
      return { color: col, h: edge * 0.7 + grain * 0.3 };
    };
  },
  shingles: (o) => {
    const n = makeNoise(o.seed); const rh = o.size / 10; const sw = o.size / 8;
    return (x, y) => {
      const row = Math.floor(y / rh); const off = (row % 2) * sw / 2;
      const sx = ((x + off) % sw + sw) % sw; const sy = y % rh;
      const edge = clamp01(Math.min(sx, sw - sx) / 2) * clamp01((rh - sy) / 3);
      const g = fbm(n, x / 12, y / 12, 3, o.size / 12);
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g + ((row * 7 + Math.floor((x + off) / sw) * 13) % 5) / 10)).map((k) => k * (0.55 + 0.45 * edge * (0.6 + sy / rh * 0.4)));
      return { color: col, h: edge * (sy / rh) };
    };
  },
  plaster: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 30, y / 30, 5, o.size / 30);
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g * 1.2));
      return { color: col, h: clamp01(0.5 + g) };
    };
  },
  metal: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 20, y / 20, 4, o.size / 20);
      const scratch = Math.abs(n(x / 0.8, y / 30, o.size / 0.8)) < 0.04 ? 0.25 : 0;
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g)).map((k) => k + scratch);
      return { color: col, h: clamp01(0.5 + g * 0.3) };
    };
  },
  cloth: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
      const g = fbm(n, x / 25, y / 25, 3, o.size / 25);
      const col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g)).map((k) => k * (0.85 + weave * 0.2));
      return { color: col, h: weave * 0.4 };
    };
  },
};

// ---------------------------------------------------------------- build
const cache = new Map();

export function paint(name, opts, size = 256, withNormal = true) {
  const key = `${name}:${JSON.stringify(opts)}:${size}:${withNormal}`;
  if (cache.has(key)) return cache.get(key);
  const o = { ...opts, size };
  const fn = PAINTERS[opts.kind](o);
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { color: c, h } = fn(x, y);
      const i = (y * size + x) * 4;
      color[i] = c[0] * 255; color[i + 1] = c[1] * 255; color[i + 2] = c[2] * 255; color[i + 3] = 255;
      height[y * size + x] = h;
    }
  }
  const map = new THREE.DataTexture(color, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  setup(map);
  let normalMap = null;
  if (withNormal) {
    const nrm = new Uint8ClampedArray(size * size * 4);
    const str = opts.bump ?? 2.5;
    const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * str;
        const dy = (H(x, y + 1) - H(x, y - 1)) * str;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nrm[i] = (-dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
      }
    }
    normalMap = new THREE.DataTexture(nrm, size, size, THREE.RGBAFormat);
    setup(normalMap);
  }
  const out = { map, normalMap };
  cache.set(key, out);
  return out;
}

function setup(t) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
}

// Theme palettes for dungeon floors/walls and the town.
export const THEME_TEX = {
  crypt: {
    floor: { kind: 'flagstone', a: 0x5d5a55, b: 0x3b3936, seed: 11, cells: 26, moss: 0x34402a },
    wall: { kind: 'brick', a: 0x5a544c, b: 0x3a3631, seed: 12, rows: 6, cols: 3 },
    top: { kind: 'rock', a: 0x1d1b19, b: 0x2b2826, seed: 13 },
    pillar: { kind: 'brick', a: 0x67625a, b: 0x46423c, seed: 14, rows: 10, cols: 2 },
    fog: 0x07080b, ambient: 0x4a5266, torch: 0xff9a4a, key: 0x9aa6c8,
  },
  cavern: {
    floor: { kind: 'dirt', a: 0x5a4632, b: 0x3a2c1f, seed: 21 },
    wall: { kind: 'rock', a: 0x5a4a3a, b: 0x2c241b, seed: 22 },
    top: { kind: 'rock', a: 0x1c1712, b: 0x2c241b, seed: 23 },
    pillar: { kind: 'rock', a: 0x625040, b: 0x3a2f24, seed: 24 },
    fog: 0x0a0806, ambient: 0x5a5040, torch: 0xffa95a, key: 0xb0a080,
  },
  infernal: {
    floor: { kind: 'flagstone', a: 0x4a2a24, b: 0x2a1512, seed: 31, cells: 22 },
    wall: { kind: 'rock', a: 0x4a2620, b: 0x1e0d0a, seed: 32, glow: true },
    top: { kind: 'rock', a: 0x1a0a08, b: 0x2a1210, seed: 33 },
    pillar: { kind: 'brick', a: 0x4a2c26, b: 0x2a1612, seed: 34, rows: 10, cols: 2 },
    fog: 0x120403, ambient: 0x6a3a30, torch: 0xff6a2a, key: 0xc06050,
  },
  town: {
    grass: { kind: 'grass', a: 0x3f6a2a, b: 0x5d8a36, seed: 41 },
    cobble: { kind: 'cobble', a: 0x8a8074, b: 0x5e564c, seed: 42 },
    plaster: { kind: 'plaster', a: 0xd8cbb0, b: 0xb8a98a, seed: 43 },
    timber: { kind: 'planks', a: 0x5a3a20, b: 0x3a2412, seed: 44, n: 4 },
    roof: { kind: 'shingles', a: 0x7a3a2a, b: 0x4a2418, seed: 45 },
    roof2: { kind: 'shingles', a: 0x4a4a52, b: 0x2a2a32, seed: 46 },
    stone: { kind: 'brick', a: 0x8a8278, b: 0x5e584e, seed: 47, rows: 8, cols: 4 },
    bark: { kind: 'planks', a: 0x4a3420, b: 0x2a1c10, seed: 48, n: 10 },
  },
  common: {
    wood: { kind: 'planks', a: 0x7a5530, b: 0x4a3018, seed: 51, n: 5 },
    darkwood: { kind: 'planks', a: 0x4a3018, b: 0x24160a, seed: 52, n: 5 },
    iron: { kind: 'metal', a: 0x6a6e74, b: 0x3a3c40, seed: 53 },
    steel: { kind: 'metal', a: 0xb8bcc4, b: 0x7a7e86, seed: 54 },
    gold: { kind: 'metal', a: 0xf0c060, b: 0xa07020, seed: 55 },
    cloth: { kind: 'cloth', a: 0x8a2028, b: 0x5a1018, seed: 56 },
    clothN: { kind: 'cloth', a: 0xe8e8e8, b: 0xa8a8a8, seed: 59 }, // neutral, tinted by the material color
    bone: { kind: 'plaster', a: 0xe8dcc0, b: 0xb8a888, seed: 57 },
    leather: { kind: 'plaster', a: 0x6a4428, b: 0x3a2414, seed: 58 },
  },
};
