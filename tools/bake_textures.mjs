// Pre-renders every procedural texture palette to WebP in public/tex/ so the game doesn't
// have to paint them in the browser (zones load in a blink instead of seconds).
// Usage: node tools/bake_textures.mjs        (needs python3 with Pillow for WebP encoding)
// Re-run after changing a painter or palette in public/js/render/textures.js (and bump
// PAINT_VERSION there so stale bakes are ignored).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paint, THEME_TEX, texHash, PAINT_VERSION } from '../public/js/render/textures.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public/tex');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scbake-'));
fs.mkdirSync(OUT, { recursive: true });
const BIG = new Set(['floor', 'wall', 'top', 'grass', 'cobble', 'dirt', 'plaster', 'stone', 'roof', 'roof2', 'roof3']);

const jobs = []; const manifest = { v: PAINT_VERSION, tex: {} };
for (const [theme, set] of Object.entries(THEME_TEX)) {
  for (const [k, def] of Object.entries(set)) {
    if (!def || typeof def !== 'object' || !def.kind) continue;
    const h = texHash(def);
    if (manifest.tex[h]) continue;
    const size = BIG.has(k) && theme !== 'common' && theme !== 'extra' ? 512 : 256;
    const t0 = Date.now();
    const t = paint(`bake-${theme}-${k}`, def, size, true);
    const put = (suffix, tex, mode) => {
      const src = tex.image.data; let buf = Buffer.from(src.buffer, src.byteOffset, src.byteLength);
      if (mode === 'L') { const g = Buffer.alloc(size * size); for (let i = 0; i < g.length; i++) g[i] = src[i * 4 + 1]; buf = g; }
      else if (mode === 'RGB') { const g = Buffer.alloc(size * size * 3); for (let i = 0; i < size * size; i++) { g[i * 3] = src[i * 4]; g[i * 3 + 1] = src[i * 4 + 1]; g[i * 3 + 2] = src[i * 4 + 2]; } buf = g; }
      const raw = path.join(TMP, `${h}_${suffix}.raw`);
      fs.writeFileSync(raw, buf);
      jobs.push({ raw, out: path.join(OUT, `${h}_${suffix}.webp`), mode, size, q: suffix === 'n' ? 92 : 84 });
    };
    put('a', t.map, 'RGB');
    put('n', t.normalMap, 'RGB');
    if (t.roughnessMap) put('r', t.roughnessMap, 'L');
    if (t.emissiveMap) put('e', t.emissiveMap, 'RGB');
    manifest.tex[h] = { s: size, n: 1, r: t.roughnessMap ? 1 : 0, e: t.emissiveMap ? 1 : 0, name: `${theme}.${k}` };
    console.log(`${theme}.${k} ${def.kind} ${size}px ${Date.now() - t0}ms`);
  }
}
const py = `import json,sys
from PIL import Image
for j in json.load(open(sys.argv[1])):
    im = Image.frombytes(j['mode'], (j['size'], j['size']), open(j['raw'],'rb').read())
    im.save(j['out'], 'WEBP', quality=j['q'], method=6)
`;
fs.writeFileSync(path.join(TMP, 'jobs.json'), JSON.stringify(jobs));
fs.writeFileSync(path.join(TMP, 'enc.py'), py);
const r = spawnSync('python3', [path.join(TMP, 'enc.py'), path.join(TMP, 'jobs.json')], { stdio: 'inherit' });
if (r.status !== 0) { console.error('WebP encoding failed (is Pillow installed?)'); process.exit(1); }
// drop files from older bakes
const keep = new Set(jobs.map((j) => path.basename(j.out)));
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp') && !keep.has(f)) fs.unlinkSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.rmSync(TMP, { recursive: true, force: true });
const bytes = [...keep].reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`baked ${Object.keys(manifest.tex).length} textures, ${jobs.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
