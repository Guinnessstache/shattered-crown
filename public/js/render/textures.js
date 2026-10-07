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
    // Non-integer periods would index outside the permutation table (diagonal artifacts);
    // stretch the input slightly instead so the noise still tiles exactly.
    const pi = Math.max(1, Math.round(per));
    if (pi !== per) { const k = pi / per; x *= k; y *= k; per = pi; }
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

// Tileable jittered-grid Worley cells: F1/F2 distances and a per-cell id. O(9) per pixel.
function cells(size, count, seed) {
  const n = Math.max(2, Math.round(Math.sqrt(count)));
  const step = size / n;
  const pts = new Float32Array(n * n * 3);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n * n; i++) { pts[i * 3] = 0.12 + rnd() * 0.76; pts[i * 3 + 1] = 0.12 + rnd() * 0.76; pts[i * 3 + 2] = rnd(); }
  return (x, y) => {
    const gx = Math.floor(x / step); const gy = Math.floor(y / step);
    let d1 = 1e9; let d2 = 1e9; let id = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox; const cy = gy + oy;
      const wx = ((cx % n) + n) % n; const wy = ((cy % n) + n) % n;
      const k = (wy * n + wx) * 3;
      const px = (cx + pts[k]) * step; const py = (cy + pts[k + 1]) * step;
      const dx = x - px; const dy = y - py; const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; id = pts[k + 2]; } else if (d < d2) d2 = d;
    }
    return { edge: Math.sqrt(d2) - Math.sqrt(d1), id, d1: Math.sqrt(d1) };
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const hash1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// ---------------------------------------------------------------- painters
// Each painter returns { color: [r,g,b] 0..1, h: height 0..1, r?: roughness 0..1, e?: emissive [r,g,b] }.
const PAINTERS = {
  // Laid rectangular flagstones: staggered rows of random widths, chipped edges, cracks, grime
  // in the joints, worn polished centres and the odd wet puddle.
  ashlar: (o) => {
    const n = makeNoise(o.seed); const S = o.size;
    const rows = o.rows || 4; const rh = S / rows;
    let s = o.seed * 7 + 3; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rowCuts = [];
    for (let r = 0; r < rows; r++) {
      const cuts = [0]; let x = 0; const off = rnd() * S;
      while (x < S - S * 0.22) { x += S * (0.18 + rnd() * 0.2); if (x < S - S * 0.12) cuts.push(x); }
      rowCuts.push({ cuts, off });
    }
    const A = hex(o.a); const B = hex(o.b); const grime = hex(o.grime || 0x1c1916); const moss = o.moss ? hex(o.moss) : null;
    return (x, y) => {
      // wobble the joints so the slabs don't look ruled
      const wx = x + n(x / 9, y / 9, S / 9) * 2.2; const wy = y + n(x / 9 + 50, y / 9, S / 9) * 2.2;
      const r = ((Math.floor(wy / rh) % rows) + rows) % rows; const ly = ((wy % rh) + rh) % rh;
      const { cuts, off } = rowCuts[r];
      const sx = (((wx + off) % S) + S) % S;
      let i = 0; while (i + 1 < cuts.length && cuts[i + 1] <= sx) i++;
      const x0 = cuts[i]; const x1 = i + 1 < cuts.length ? cuts[i + 1] : S;
      const id = hash1(r * 31 + i * 7 + o.seed);
      const dEdge = Math.min(sx - x0, x1 - sx, ly, rh - ly);
      const chip = fbm(n, x / 5, y / 5, 2, S / 5) * 3.5;
      const joint = sstep(0.8, 3.2, dEdge + chip);
      const bevel = sstep(0, 9, dEdge + chip * 0.6);
      const g = fbm(n, x / 26, y / 26, 4, S / 26);
      const grit = n(x / 1.7, y / 1.7, S / 1.7);
      const crackN = Math.abs(fbm(n, x / 34 + id * 40, y / 34, 3, S / 34));
      const crack = id > 0.55 ? sstep(0.035, 0.0, crackN) * sstep(4, 14, dEdge) : 0;
      let col = mix3(A, B, clamp01(0.5 + g * 0.9 + (id - 0.5) * 0.7));
      col = mul3(col, (0.8 + 0.2 * bevel) * (0.93 + grit * 0.12));
      // dirt gathers toward the joints
      col = mix3(col, grime, (1 - joint) * 0.85 + (1 - bevel) * 0.25 + crack * 0.7);
      if (moss) col = mix3(col, moss, clamp01(fbm(n, x / 40 + 9, y / 40, 3, S / 40) * 2.4 - 0.3) * (1 - bevel) * 0.8);
      const wet = sstep(0.12, 0.4, fbm(n, x / 70 + 21, y / 70 - 4, 3, S / 70)) * (o.wet ?? 1);
      col = mul3(col, 1 - wet * 0.14);
      const h = joint * (0.55 + 0.45 * bevel) - crack * 0.4 + g * 0.06;
      const rough = clamp01(0.88 - bevel * 0.12 + (1 - joint) * 0.1 - wet * 0.45 + grit * 0.04);
      return { color: col, h: lerp(h, 0.62, wet * 0.5), r: rough };
    };
  },
  flagstone: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, o.cells || 14, o.seed + 7);
    return (x, y) => {
      const v = c(x + n(x / 10, y / 10, o.size / 10) * 3, y + n(x / 10 + 7, y / 10, o.size / 10) * 3);
      const g = fbm(n, x / 18, y / 18, 4, o.size / 18);
      const grit = n(x / 2.3, y / 2.3, o.size / 2.3) * 0.5;
      const groove = sstep(0.5, 4, v.edge);
      const bevel = sstep(0, 12, v.edge);
      const base = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g * 0.9 + (v.id - 0.5) * 0.6));
      const shade = (0.6 + 0.4 * bevel) * (0.92 + grit * 0.16);
      let col = mix3(mul3(base, shade), hex(o.grime || 0x140c0a), (1 - groove) * 0.8);
      if (o.moss) col = mix3(col, hex(o.moss), clamp01(fbm(n, x / 30 + 9, y / 30, 3, o.size / 30) * 2 - 0.25) * (1 - bevel) * 0.5);
      let e = null;
      if (o.lava) {
        // molten seams glowing in some of the joints
        const seam = sstep(1.6, 0, v.edge) * sstep(0.05, 0.25, fbm(n, x / 45 + 3, y / 45, 3, o.size / 45));
        if (seam > 0) { e = [seam * 1.0, seam * 0.32, seam * 0.05]; col = mix3(col, [0.25, 0.06, 0.02], seam); }
      }
      return { color: col, h: groove * (0.6 + 0.4 * bevel) + g * 0.12 + grit * 0.05, r: clamp01(0.9 - bevel * 0.15 + (1 - groove) * 0.08), e };
    };
  },
  brick: (o) => {
    const n = makeNoise(o.seed);
    const rows = o.rows || 8; const bw = o.size / (o.cols || 4); const bh = o.size / rows;
    const mortar = hex(o.mortar || 0x1a1612);
    return (x, y) => {
      const row = Math.floor(y / bh);
      const off = (row % 2) * bw * 0.5 + hash1(row * 3.7 + o.seed) * bw * 0.18;
      const bx = ((x + off) % bw + bw) % bw; const by = y % bh;
      const brickId = Math.floor((x + off) / bw) * 17 + row * 31;
      const chip = fbm(n, x / 4, y / 4, 2, o.size / 4) * 3 + Math.max(0, n(x / 11, y / 11, o.size / 11)) * 4;
      const mort = Math.min(bx, bw - bx, by, bh - by) - chip;
      const groove = sstep(0.4, 2.6, mort);
      const bevel = sstep(0, 8, mort);
      const g = fbm(n, x / 14, y / 14, 4, o.size / 14);
      const tint = hash1(brickId);
      let base = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g + (tint - 0.5) * 0.7));
      base = mul3(base, (0.72 + 0.28 * bevel) * (0.9 + g * 0.2));
      const soot = clamp01(fbm(n, x / 50 + 30, y / 50, 3, o.size / 50) * 1.8);
      base = mul3(base, 1 - soot * 0.35);
      let col = mix3(mortar, base, groove);
      let e = null;
      if (o.glow) {
        const v = sstep(1.2, 0, mort) * sstep(0.1, 0.3, fbm(n, x / 40, y / 40 + 11, 3, o.size / 40));
        if (v > 0) { e = [v, v * 0.3, v * 0.04]; col = mix3(col, [0.2, 0.05, 0.02], v); }
      }
      return { color: col, h: groove * (0.55 + 0.45 * bevel) + g * 0.12, r: clamp01(0.95 - bevel * 0.08), e };
    };
  },
  // Chiselled rock: domed Worley facets with dark cracks between them, two scales of
  // grain, faint strata and (optionally) damp patches or glowing magma veins.
  rock: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, o.cells || 40, o.seed + 5); const c2 = cells(o.size, 170, o.seed + 6);
    const A = hex(o.a); const B = hex(o.b); const C = hex(o.c || o.b);
    return (x, y) => {
      const wx = x + fbm(n, x / 30, y / 30, 2, o.size / 30) * 10; const wy = y + fbm(n, x / 30 + 7, y / 30, 2, o.size / 30) * 10;
      const v = c(wx, wy); const v2 = c2(wx, wy);
      const g = fbm(n, x / 26, y / 26, 4, o.size / 26);
      const grain = n(x / 3, y / 3, o.size / 3);
      const facet = sstep(0, 22, v.edge); const small = sstep(0, 7, v2.edge);
      const crack = sstep(2.2, 0, v.edge);
      const strata = Math.sin((y + g * 40) / (o.size / 7) * Math.PI * 2) * 0.5 + 0.5;
      let col = mix3(A, B, clamp01(0.5 + g * 0.9 + (v.id - 0.5) * 0.7));
      col = mix3(col, C, strata * 0.3);
      col = mul3(col, (0.62 + 0.38 * facet) * (0.85 + 0.15 * small) * (0.93 + grain * 0.1));
      col = mul3(col, 1 - crack * 0.75);
      const h = clamp01(0.3 + facet * 0.45 + small * 0.12 + g * 0.18 - crack * 0.4);
      let r = clamp01(0.85 + grain * 0.08 - facet * 0.06);
      if (o.damp) { const d = sstep(0.12, 0.35, fbm(n, x / 50 + 3, y / 60, 3, o.size / 50)); col = mul3(col, 1 - d * 0.3); r -= d * 0.5; }
      let e = null;
      if (o.glow) {
        const vein = sstep(1.8, 0, v.edge) * sstep(0.02, 0.28, fbm(n, x / 80, y / 80 + 20, 2, o.size / 80));
        col = mix3(col, [0.08, 0.03, 0.02], sstep(6, 0, v.edge) * 0.6);
        if (vein > 0.01) { e = [vein, vein * 0.32, vein * 0.05]; col = mix3(col, [0.3, 0.07, 0.02], vein); }
      }
      return { color: col, h, r: clamp01(r), e };
    };
  },
  dirt: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, 260, o.seed + 9);
    return (x, y) => {
      const g = fbm(n, x / 22, y / 22, 5, o.size / 22);
      const v = c(x, y);
      const pebble = v.id > 0.62 ? sstep(5.5, 2.5, v.d1) : 0;
      const grit = n(x / 1.6, y / 1.6, o.size / 1.6);
      let col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g + grit * 0.15));
      col = mix3(col, mix3(hex(o.stone || 0x6a625a), hex(0x3a342e), v.id), pebble * 0.85);
      const damp = sstep(0.15, 0.35, fbm(n, x / 60 + 5, y / 60, 3, o.size / 60));
      col = mul3(col, 1 - damp * 0.4);
      return { color: col, h: clamp01(0.4 + g * 0.4 + pebble * 0.5 + grit * 0.05), r: clamp01(0.95 - damp * 0.55 - pebble * 0.2) };
    };
  },
  grass: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 40, y / 40, 4, o.size / 40);
      const blade = n(x / 1.2, y / 3.5, o.size / 1.2) * 0.5 + 0.5;
      const clump = n(x / 7, y / 7, o.size / 7);
      let col = mix3(hex(o.a), hex(o.b), clamp01(0.45 + g * 1.1 + clump * 0.2)).map((k) => k * (0.75 + blade * 0.4));
      const dry = sstep(0.15, 0.45, fbm(n, x / 55 + 17, y / 55, 3, o.size / 55));
      col = mix3(col, hex(o.dry || 0x8a8a3a), dry * 0.45);
      const bare = sstep(0.32, 0.5, fbm(n, x / 35 - 7, y / 35 + 3, 3, o.size / 35));
      col = mix3(col, hex(0x5a4630), bare * 0.7);
      const fl = n(x / 0.9 + 3, y / 0.9, o.size / 0.9);
      if (fl > 0.62 && clump > 0.25) col = hash1(Math.floor(x / 3) * 13 + Math.floor(y / 3)) > 0.5 ? [0.95, 0.9, 0.55] : [0.9, 0.92, 0.95];
      return { color: col, h: blade * 0.6 + g * 0.2, r: 0.95 };
    };
  },
  cobble: (o) => {
    const n = makeNoise(o.seed); const c = cells(o.size, o.cells || 90, o.seed + 3);
    return (x, y) => {
      const v = c(x + n(x / 8, y / 8, o.size / 8) * 1.5, y);
      const groove = sstep(0.6, 3.5, v.edge);
      const dome = Math.sqrt(sstep(0, 14, v.edge));
      const g = fbm(n, x / 10, y / 10, 3, o.size / 10);
      const big = fbm(n, x / 90, y / 90, 2, o.size / 90);
      let base = mix3(hex(o.a), hex(o.b), clamp01(v.id + g * 0.6));
      base = mix3(base, hex(o.c || o.a), clamp01(big * 1.5) * 0.4);
      const col = mix3(hex(0x2a241c).map((k) => k * (0.9 + g)), base.map((k) => k * (0.62 + 0.45 * dome)), groove);
      const moss = (1 - groove) * sstep(0, 0.4, fbm(n, x / 30, y / 30 + 9, 3, o.size / 30));
      return { color: mix3(col, hex(0x3a4a22), moss * 0.6), h: dome * groove, r: clamp01(0.62 + (1 - dome) * 0.3 + (1 - groove) * 0.1) };
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
      let col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g + ((row * 7 + Math.floor((x + off) / sw) * 13) % 5) / 10)).map((k) => k * (0.55 + 0.45 * edge * (0.6 + sy / rh * 0.4)));
      const moss = sstep(0.18, 0.4, fbm(n, x / 40 + 4, y / 40, 3, o.size / 40));
      col = mix3(col, [0.24, 0.3, 0.14], moss * 0.55);
      return { color: col, h: edge * (sy / rh), r: 0.85 - edge * 0.1 };
    };
  },
  plaster: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 30, y / 30, 5, o.size / 30);
      let col = mix3(hex(o.a), hex(o.b), clamp01(0.5 + g * 1.2));
      let h = clamp01(0.5 + g);
      if (o.stain) {
        // flaked plaster showing the brick underneath, plus rain streaks
        const flake = sstep(0.27, 0.31, fbm(n, x / 48 + 13, y / 48, 3, o.size / 48));
        if (flake > 0) {
          const bw = o.size / 6; const bh = o.size / 16; const row = Math.floor(y / bh);
          const bx = ((x + (row % 2) * bw / 2) % bw + bw) % bw; const by = y % bh;
          const m = Math.min(bx, bw - bx, by, bh - by) > 1.5 ? 1 : 0;
          col = mix3(col, m ? mix3([0.58, 0.44, 0.34], [0.46, 0.34, 0.26], hash1(row)) : [0.36, 0.33, 0.3], flake * 0.85);
          h -= flake * 0.4;
        }
        const streak = Math.max(0, n(x / 3, y / 60, o.size / 3)) * 0.25;
        col = mul3(col, 1 - streak);
      }
      return { color: col, h };
    };
  },
  metal: (o) => {
    const n = makeNoise(o.seed);
    return (x, y) => {
      const g = fbm(n, x / 20, y / 20, 4, o.size / 20);
      const scratch = Math.abs(n(x / 0.8, y / 30, o.size / 0.8)) < 0.03 ? 0.06 : 0;
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

// ---------------------------------------------------------------- baked textures
// tools/bake_textures.mjs pre-renders every palette entry to WebP (public/tex/), so zones
// load instantly; anything not baked (or after a painter change) is painted at runtime.
// Bump PAINT_VERSION whenever a painter changes, then re-run the bake.
export const PAINT_VERSION = 8;
export function texHash(opts) {
  let h = 2166136261 >>> 0;
  const s = `${PAINT_VERSION}|${JSON.stringify(opts)}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
let baked = null;
export async function loadBakedTextures() {
  try { const r = await fetch('/tex/manifest.json', { cache: 'no-cache' }); if (r.ok) baked = await r.json(); } catch { baked = null; }
}
const loader = new THREE.TextureLoader();
function bakedTex(file, srgb) {
  // Clones made before the image arrives (tiled materials) are refreshed when it lands.
  const t = loader.load(`/tex/${file}`, (tex) => { for (const c of tex.userData.clones || []) c.needsUpdate = true; tex.userData.loaded = true; });
  t.userData.clones = [];
  t.flipY = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; // no needsUpdate until the image arrives
  return t;
}

export function paint(name, opts, size = 256, withNormal = true) {
  const key = `${name}:${JSON.stringify(opts)}:${size}:${withNormal}`;
  if (cache.has(key)) return cache.get(key);
  const b = baked?.v === PAINT_VERSION && baked.tex[texHash(opts)];
  if (b) {
    const h = texHash(opts);
    const out = {
      map: bakedTex(`${h}_a.webp`, true),
      normalMap: withNormal && b.n ? bakedTex(`${h}_n.webp`, false) : null,
      roughnessMap: b.r ? bakedTex(`${h}_r.webp`, false) : null,
      emissiveMap: b.e ? bakedTex(`${h}_e.webp`, true) : null,
    };
    cache.set(key, out);
    return out;
  }
  const o = { ...opts, size };
  const fn = PAINTERS[opts.kind](o);
  const color = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  let rough = null; let emis = null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { color: c, h, r, e } = fn(x, y);
      const i = (y * size + x) * 4;
      color[i] = c[0] * 255; color[i + 1] = c[1] * 255; color[i + 2] = c[2] * 255; color[i + 3] = 255;
      height[y * size + x] = h;
      if (r !== undefined) {
        if (!rough) rough = new Uint8ClampedArray(size * size * 4).fill(255);
        rough[i + 1] = r * 255;
      }
      if (e) {
        if (!emis) { emis = new Uint8ClampedArray(size * size * 4); for (let k = 3; k < emis.length; k += 4) emis[k] = 255; }
        emis[i] = e[0] * 255; emis[i + 1] = e[1] * 255; emis[i + 2] = e[2] * 255;
      }
    }
  }
  const map = new THREE.DataTexture(color, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  setup(map);
  let normalMap = null;
  if (withNormal) {
    const nrm = new Uint8ClampedArray(size * size * 4);
    const str = (opts.bump ?? 2.5) * Math.sqrt(size / 256);
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
  let roughnessMap = null; let emissiveMap = null;
  if (rough) { roughnessMap = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat); setup(roughnessMap); }
  if (emis) { emissiveMap = new THREE.DataTexture(emis, size, size, THREE.RGBAFormat); emissiveMap.colorSpace = THREE.SRGBColorSpace; setup(emissiveMap); }
  const out = { map, normalMap, roughnessMap, emissiveMap };
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
    floor: { kind: 'ashlar', a: 0x77726a, b: 0x4a4640, grime: 0x1e1a15, seed: 11, rows: 5, moss: 0x3a4a2a, bump: 2.2 },
    wall: { kind: 'brick', a: 0x6a645a, b: 0x3e3a34, seed: 12, rows: 7, cols: 3, mortar: 0x16130f, bump: 3 },
    top: { kind: 'rock', a: 0x1d1b19, b: 0x2b2826, seed: 13 },
    pillar: { kind: 'brick', a: 0x726c62, b: 0x4a463f, seed: 14, rows: 10, cols: 2 },
    trim: { kind: 'ashlar', a: 0x7a756c, b: 0x55514a, grime: 0x24201a, seed: 15, rows: 2, wet: 0 },
    fog: 0x0a0c12, ambient: 0x5a6680, torch: 0xff9a4a, key: 0x9aa6c8,
    grade: { tint: [0.95, 1.0, 1.08], lift: [0.01, 0.012, 0.025], sat: 0.88, vig: 0.55, bloom: 0.55 },
  },
  cavern: {
    floor: { kind: 'dirt', a: 0x5e4a36, b: 0x382a1e, stone: 0x6a5e50, seed: 21, bump: 3 },
    wall: { kind: 'rock', a: 0x7a6650, b: 0x3a3026, c: 0x5e4c3a, seed: 22, damp: true, bump: 4 },
    top: { kind: 'rock', a: 0x1c1712, b: 0x2c241b, seed: 23 },
    pillar: { kind: 'rock', a: 0x7a6650, b: 0x3e3226, seed: 24, damp: true, cells: 18 },
    trim: { kind: 'rock', a: 0x6e5c48, b: 0x34291e, seed: 25, cells: 18 },
    fog: 0x0b0a08, ambient: 0x60584a, torch: 0xffa95a, key: 0xb0a080,
    grade: { tint: [1.04, 1.0, 0.92], lift: [0.012, 0.01, 0.004], sat: 0.92, vig: 0.6, bloom: 0.5 },
  },
  infernal: {
    floor: { kind: 'flagstone', a: 0x4a2c26, b: 0x24120f, seed: 31, cells: 30, lava: true, grime: 0x0e0605, bump: 3 },
    wall: { kind: 'rock', a: 0x3e2420, b: 0x170b09, c: 0x2a1512, seed: 32, glow: true, bump: 4 },
    top: { kind: 'rock', a: 0x1a0a08, b: 0x2a1210, seed: 33 },
    pillar: { kind: 'brick', a: 0x4a2c26, b: 0x2a1612, seed: 34, rows: 10, cols: 2, glow: true },
    trim: { kind: 'brick', a: 0x3a2420, b: 0x1e100d, seed: 35, rows: 2, cols: 3 },
    fog: 0x160504, ambient: 0x6a3a30, torch: 0xff6a2a, key: 0xc06050,
    grade: { tint: [1.08, 0.97, 0.9], lift: [0.025, 0.006, 0.0], sat: 1.05, vig: 0.65, bloom: 0.9 },
  },
  town: {
    grass: { kind: 'grass', a: 0x40702a, b: 0x6a9a3c, dry: 0x9a9a48, seed: 41 },
    cobble: { kind: 'cobble', a: 0x948a7c, b: 0x5e564c, c: 0x8a7a64, seed: 42, cells: 784, bump: 3 },
    dirt: { kind: 'dirt', a: 0x7a6248, b: 0x56422e, stone: 0x8a8070, seed: 49 },
    plaster: { kind: 'plaster', a: 0xe2d6bc, b: 0xbfae8e, seed: 43, stain: true },
    timber: { kind: 'planks', a: 0x5a3a20, b: 0x3a2412, seed: 44, n: 4 },
    roof: { kind: 'shingles', a: 0x8a4430, b: 0x4a2418, seed: 45 },
    roof2: { kind: 'shingles', a: 0x4e5260, b: 0x2a2c36, seed: 46 },
    roof3: { kind: 'shingles', a: 0x9a7a40, b: 0x5a4422, seed: 60 },
    stone: { kind: 'brick', a: 0x8e867a, b: 0x5e584e, seed: 47, rows: 8, cols: 4 },
    bark: { kind: 'planks', a: 0x4a3420, b: 0x2a1c10, seed: 48, n: 10 },
    grade: { tint: [1.06, 1.0, 0.92], lift: [0.012, 0.01, 0.02], sat: 1.08, vig: 0.4, bloom: 0.35 },
  },
  extra: {
    sand: { kind: 'plaster', a: 0xc8a878, b: 0x9a7a50, seed: 77 },
    rock: { kind: 'rock', a: 0x9a9488, b: 0x5a554c, c: 0x7a7468, seed: 61, cells: 14 },
    hay: { kind: 'planks', a: 0xd8b860, b: 0xa08030, seed: 62, n: 24 },
    townStatue: { kind: 'plaster', a: 0xc8c2b4, b: 0x8a8478, seed: 72 },
    statue: { kind: 'plaster', a: 0x9a968c, b: 0x6a665e, seed: 71 },
    obsidianStatue: { kind: 'plaster', a: 0x3a3236, b: 0x1a1418, seed: 71 },
    water: { kind: 'plaster', a: 0xffffff, b: 0x000000, seed: 88, bump: 6 },
  },
  common: {
    wood: { kind: 'planks', a: 0x7a5530, b: 0x4a3018, seed: 51, n: 5 },
    darkwood: { kind: 'planks', a: 0x4a3018, b: 0x24160a, seed: 52, n: 5 },
    iron: { kind: 'metal', a: 0x6a6e74, b: 0x4a4c50, seed: 53, bump: 0.7 },
    steel: { kind: 'metal', a: 0xb8bcc4, b: 0x8a8e96, seed: 54, bump: 0.5 },
    gold: { kind: 'metal', a: 0xf0c060, b: 0xb88a30, seed: 55, bump: 0.5 },
    cloth: { kind: 'cloth', a: 0x8a2028, b: 0x5a1018, seed: 56 },
    clothN: { kind: 'cloth', a: 0xe8e8e8, b: 0xa8a8a8, seed: 59 }, // neutral, tinted by the material color
    bone: { kind: 'plaster', a: 0xe8dcc0, b: 0xb8a888, seed: 57 },
    leather: { kind: 'plaster', a: 0x6a4428, b: 0x3a2414, seed: 58 },
  },
};
