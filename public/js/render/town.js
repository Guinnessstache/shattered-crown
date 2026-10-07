// Emberfall Village: blended ground (grass → worn dirt → cobbles with soft, noisy edges),
// swaying grass and wildflowers, sky, distant mountains, chimney smoke, market clutter and
// a statue fountain. Clutter only sits in the strips the collision never lets heroes enter.
import * as THREE from 'three';
import { TILE, T } from '/shared/map.js';
import { RNG, hashSeed } from '/shared/rng.js';
import { texMat, common, flat, glow, softTexture } from './materials.js';
import { THEME_TEX } from './textures.js';
import { buildStatue } from './models.js';
import * as P from './props.js';

const M = 6; // margin tiles of ground around the town
const R = 8; // mask pixels per tile

// ---------------------------------------------------------------- shared uniforms
export const townUniforms = { uTime: { value: 0 } };

// ---------------------------------------------------------------- ground
function makeMask(map, blur, lo, hi, seed) {
  const W = (map.w + M * 2) * R; const H = (map.h + M * 2) * R;
  let a = new Float32Array(W * H);
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!map.ground[ty * map.w + tx]) continue;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) a[((ty + M) * R + y) * W + (tx + M) * R + x] = 1;
  }
  // separable box blur, three passes ≈ gaussian
  const tmp = new Float32Array(W * H);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) { let s = 0; for (let x = -blur; x <= blur; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { tmp[y * W + x] = s / (blur * 2 + 1); s += a[y * W + Math.min(W - 1, x + blur + 1)] - a[y * W + Math.max(0, x - blur)]; } }
    for (let x = 0; x < W; x++) { let s = 0; for (let y = -blur; y <= blur; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { a[y * W + x] = s / (blur * 2 + 1); s += tmp[Math.min(H - 1, y + blur + 1) * W + x] - tmp[Math.max(0, y - blur) * W + x]; } }
  }
  const rng = new RNG(seed); const N = 64; const g = new Float32Array(N * N).map(() => rng.next());
  const vn = (x, y) => { const X = Math.floor(x); const Y = Math.floor(y); const fx = x - X; const fy = y - Y; const at = (i, j) => g[((j % N + N) % N) * N + ((i % N + N) % N)]; const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy); return (at(X, Y) * (1 - sx) + at(X + 1, Y) * sx) * (1 - sy) + (at(X, Y + 1) * (1 - sx) + at(X + 1, Y + 1) * sx) * sy; };
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = vn(x / 9, y / 9) * 0.6 + vn(x / 3, y / 3) * 0.4 - 0.5;
    let v = a[y * W + x] + n * 0.45;
    v = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = v * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.flipY = false; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.channel = 1; t.needsUpdate = true;
  return { tex: t, a, W, H };
}

function groundQuad(map, y) {
  const x0 = -M * TILE; const z0 = -M * TILE; const x1 = (map.w + M) * TILE; const z1 = (map.h + M) * TILE;
  const g = new THREE.BufferGeometry();
  const pos = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / 5, z0 / 5, x1 / 5, z0 / 5, x1 / 5, z1 / 5, x0 / 5, z1 / 5], 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 3, 1, 1, 3, 2]);
  return g;
}

export function buildTownGround(map, root, quality) {
  const T2 = THEME_TEX.town;
  const grass = texMat('town-grass', T2.grass, { rough: 1 });
  const base = new THREE.Mesh(groundQuad(map, 0), grass); base.receiveShadow = true; root.add(base);
  const dirtM = makeMask(map, 9, 0.05, 0.4, 7);
  const cobM = makeMask(map, 3, 0.42, 0.62, 9);
  const dirt = texMat('town-dirt', T2.dirt, { rough: 1 }).clone();
  dirt.alphaMap = dirtM.tex; dirt.transparent = true; dirt.depthWrite = false;
  const cob = texMat('town-cobble', T2.cobble, { rough: 0.85 }).clone();
  cob.alphaMap = cobM.tex; cob.transparent = true; cob.depthWrite = false;
  const d = new THREE.Mesh(groundQuad(map, 0.004), dirt); d.receiveShadow = true; d.renderOrder = -2; root.add(d);
  const c = new THREE.Mesh(groundQuad(map, 0.008), cob); c.receiveShadow = true; c.renderOrder = -1; root.add(c);
  root.userData.cobbleMask = cobM; root.userData.dirtMask = dirtM;
  // big outer field fading into fog
  const far = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x3a5a26, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.set(map.w, -0.03, map.h);
  root.add(far);
}

export function buildTownBorder(map, batch, quality) {
  // Palisade along the town edge plus a ring of forest outside it.
  const W = map.w * TILE; const H = map.h * TILE;
  const seg = (x, y, len, rot) => batch.addObject(P.place(P.palisade(len), x, y, rot));
  seg(W / 2, 1, W - 2, 0); seg(W / 2, H - 1, W - 2, 0);
  seg(1, H / 2, H - 2, Math.PI / 2); seg(W - 1, H / 2, H - 2, Math.PI / 2);
  const rng = new RNG(77); const rnd = () => rng.next();
  const n = quality === 'low' ? 90 : 170;
  const forest = new P.Batcher({ shadows: false }); // far trees: no shadow casting
  batch.extra = forest;
  for (let i = 0; i < n; i++) {
    const side = i % 4; const t = rnd();
    const out = 2.5 + rnd() * (i < 90 ? 10 : 26);
    const x = side < 2 ? -8 + t * (W + 16) : side === 2 ? -out : W + out;
    const y = side >= 2 ? -8 + t * (H + 16) : side === 0 ? -out : H + out;
    const near = out < 6;
    (near ? batch : forest).addObject(P.place(P.tree(0.95 + rnd() * 0.9, Math.floor(rnd() * 1000)), x, y, rnd() * 6));
  }
  // The dungeon gate sits in a rocky outcrop: boulders on the wall tiles near it.
  const stone = texMat('town-rock', THEME_TEX.extra.rock, { size: 256 });
  for (let tx = 0; tx < map.w; tx++) for (let ty = 0; ty < map.h; ty++) {
    if (map.get(tx, ty) === T.WALL && tx > 0 && ty > 0 && tx < map.w - 1 && ty < map.h - 1) {
      const g = new THREE.IcosahedronGeometry(1.25, 1);
      const p = g.attributes.position; const r2 = new RNG(tx * 31 + ty);
      for (let i = 0; i < p.count; i++) { const k = 0.8 + r2.next() * 0.35; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      g.computeVertexNormals();
      const rock = P.mesh(g, stone, 0, 0.9, 0);
      rock.scale.set(1.05, 1.5, 1.05);
      const gq = new THREE.Group(); gq.add(rock);
      batch.addObject(P.place(gq, tx * TILE + 1, ty * TILE + 1, tx * 1.3));
    }
  }
}

// ---------------------------------------------------------------- grass & flowers
function bladeTexture(flowers) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < (flowers ? 9 : 22); i++) {
    const x = 10 + Math.random() * 108; const h = 60 + Math.random() * 64; const lean = (Math.random() - 0.5) * 30;
    const shade = 150 + Math.random() * 105;
    g.strokeStyle = `rgb(${shade * 0.75 | 0},${shade | 0},${shade * 0.55 | 0})`; g.lineWidth = 2 + Math.random() * 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.stroke();
    if (flowers && i % 2 === 0) {
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 5; k++) { const a = k / 5 * 6.28; g.beginPath(); g.arc(x + lean + Math.cos(a) * 5, 128 - h + Math.sin(a) * 5, 4.2, 0, 7); g.fill(); }
      g.fillStyle = '#ffd040'; g.beginPath(); g.arc(x + lean, 128 - h, 3, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tuftGeometry(w, h) {
  const parts = [];
  for (let i = 0; i < 3; i++) { const p = new THREE.PlaneGeometry(w, h); p.translate(0, h / 2, 0); p.rotateY(i * Math.PI / 3); parts.push(p); }
  const g = new THREE.BufferGeometry();
  const pos = []; const uv = []; const nrm = [];
  for (const p of parts) { const q = p.toNonIndexed(); pos.push(...q.attributes.position.array); uv.push(...q.attributes.uv.array); for (let i = 0; i < q.attributes.position.count; i++) nrm.push(0, 1, 0); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function swayMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = townUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uTime * 1.7 + ip.x * 0.35 + ip.y * 0.21) * 0.6 + sin(uTime * 3.1 + ip.x * 0.9) * 0.25;
        transformed.x += sw * 0.12 * uv.y * uv.y;
        transformed.z += sw * 0.06 * uv.y * uv.y;`);
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

function scatterGrass(map, root, quality, rng) {
  if (quality === 'low') return;
  const per = quality === 'high' ? 7 : 3;
  const mask = root.userData.dirtMask;
  const maskAt = (x, z) => { const px = Math.floor((x / TILE + M) * R); const pz = Math.floor((z / TILE + M) * R); if (px < 0 || pz < 0 || px >= mask.W || pz >= mask.H) return 0; return mask.a[pz * mask.W + px]; };
  const okTile = (x, z) => {
    const tx = Math.floor(x / TILE); const ty = Math.floor(z / TILE);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
    const v = map.get(tx, ty);
    if (v === T.WALL && tx > 0 && ty > 0 && tx < map.w - 1 && ty < map.h - 1) return false;
    if (map.arena && Math.hypot(x - map.arena.x, z - map.arena.y) < map.arena.r + 0.6) return false;
    return !map.props.some((p) => (p.type === 'house' || p.type === 'fountain') && Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.y) < p.d / 2);
  };
  const pts = []; const fpts = [];
  for (let ty = -M; ty < map.h + M; ty++) for (let tx = -M; tx < map.w + M; tx++) {
    for (let i = 0; i < per; i++) {
      const x = (tx + rng.next()) * TILE; const z = (ty + rng.next()) * TILE;
      const m = maskAt(x, z);
      if (m > 0.22 || !okTile(x, z)) continue;
      const patch = Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2) * Math.cos(z * 0.23 - x * 0.05);
      if (patch > 0.55 && rng.next() < 0.7) fpts.push([x, z]); else pts.push([x, z, m]);
    }
  }
  const mk = (list, geo, mat, colorFn) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const mm = new THREE.Matrix4(); const q = new THREE.Quaternion(); const c = new THREE.Color();
    list.forEach(([x, z, m], i) => {
      const s = (0.7 + rng.next() * 0.6) * (1 - (m || 0) * 1.5);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * 6.28);
      mm.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + rng.next() * 0.5), s));
      im.setMatrixAt(i, mm); im.setColorAt(i, colorFn(c));
    });
    im.receiveShadow = true; im.castShadow = false;
    im.frustumCulled = false;
    root.add(im);
  };
  mk(pts, tuftGeometry(0.7, 0.55), swayMaterial(bladeTexture(false)), (c) => c.setHSL(0.24 + rng.next() * 0.06, 0.45 + rng.next() * 0.2, 0.32 + rng.next() * 0.14));
  const palette = [0xffffff, 0xffd84a, 0xd86aff, 0xff6a6a, 0x7ab0ff, 0xffa8d0];
  mk(fpts, tuftGeometry(0.6, 0.5), swayMaterial(bladeTexture(true)), (c) => c.set(palette[Math.floor(rng.next() * palette.length)]).lerp(new THREE.Color(1, 1, 1), 0.2));
}

// ---------------------------------------------------------------- sky
export function buildSky() {
  const g = new THREE.SphereGeometry(400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(-0.55, 0.32, 0.4).normalize() }, uTime: townUniforms.uTime },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float y = max(d.y, -0.1);
        vec3 zen = vec3(0.24,0.42,0.72); vec3 hor = vec3(0.86,0.80,0.70);
        vec3 col = mix(hor, zen, pow(clamp(y,0.0,1.0), 0.55));
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0,0.75,0.45) * pow(sd, 6.0) * 0.45 + vec3(1.0,0.9,0.7) * pow(sd, 400.0) * 4.0;
        vec2 cp = d.xz / max(y + 0.12, 0.05) * 1.3 + vec2(uTime * 0.012, 0.0);
        float cl = smoothstep(0.5, 0.82, fbm(cp));
        vec3 ccol = mix(vec3(1.0,0.96,0.9), vec3(1.0,0.8,0.6), pow(sd, 3.0)) * (0.82 + 0.18 * fbm(cp * 2.0 + 3.0));
        col = mix(col, ccol, cl * smoothstep(0.0, 0.25, y) * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -10; sky.frustumCulled = false;
  return sky;
}

export function buildMountains(cx, cz) {
  const g = new THREE.BufferGeometry(); const pos = []; const col = [];
  const rng = new RNG(5);
  const rings = [[300, 80, [0.5, 0.56, 0.66]], [230, 46, [0.36, 0.43, 0.46]]];
  for (const [rad, hmax, c] of rings) {
    const N = 160; let prev = null; const hs = [];
    let hh = 0.5;
    for (let i = 0; i <= N; i++) { hh += (rng.next() - 0.5) * 0.35; hh = Math.max(0.15, Math.min(1, hh)); hs.push(hh * (0.6 + 0.4 * Math.sin(i * 0.11) ** 2)); }
    hs[N] = hs[0];
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2; const x = cx + Math.cos(a) * rad; const z = cz + Math.sin(a) * rad; const y = hs[i] * hmax;
      if (prev) {
        const [px, py, pz] = prev;
        pos.push(px, -5, pz, x, -5, z, x, y, z, px, -5, pz, x, y, z, px, py, pz);
        const top = [c[0] * 1.15, c[1] * 1.12, c[2] * 1.08];
        col.push(...c, ...c, ...top, ...c, ...top, ...top);
      }
      prev = [x, y, z];
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = -9;
  return mesh;
}

// ---------------------------------------------------------------- dressing
export function dressTown(map, ctx) {
  const { root, batch, anim, lights, quality } = ctx;
  const rng = new RNG(hashSeed('town-dress')); const rnd = () => rng.next();
  scatterGrass(map, root, quality, rng);
  townUniforms.uTime.value = 0;
  const swayTick = new THREE.Object3D(); swayTick.userData.tick = (t) => { townUniforms.uTime.value = t; }; anim.push(swayTick);

  const wood = common('wood', { rough: 0.85 }); const dark = common('darkwood');
  const hay = texMat('town-hay', THEME_TEX.extra.hay, { size: 256 });

  // Around each house: barrels, crates, benches, firewood and flower beds in the strip
  // between the walls and where heroes can walk.
  for (const p of map.props) {
    if (p.type !== 'house') continue;
    const W = p.w - 0.4; const D = p.d - 0.4;
    const fwd = p.rot ? -1 : 1; // street side is +z in house space
    const at = (lx, lz) => [p.x + lx * (p.rot ? -1 : 1), p.y + lz * fwd];
    const sideZ = D / 2 + 0.35;
    const spots = [-W / 2 + 0.5, -W / 4 - 0.4, W / 4 + 0.4, W / 2 - 0.5];
    for (const lx of spots) {
      const r = rnd();
      const [x, y] = at(lx, sideZ);
      if (Math.abs(lx) < 1) continue; // keep the door clear
      if (r < 0.3) batch.addObject(P.place(P.barrel(), x, y, rnd() * 6, 0.8));
      else if (r < 0.5) batch.addObject(P.place(P.crate(), x, y, rnd() * 0.4, 0.62));
      else if (r < 0.7) batch.addObject(P.place(flowerBed(), x, y, p.rot));
      else if (r < 0.85) batch.addObject(P.place(bench(wood), x, y, p.rot));
    }
    // firewood stack and a hay bale on the gable ends
    for (const s of [-1, 1]) {
      const [x, y] = at(s * (W / 2 + 0.38), (rnd() - 0.5) * D * 0.5);
      if (rnd() < 0.5) batch.addObject(P.place(woodpile(dark), x, y, p.rot + Math.PI / 2));
      else batch.addObject(P.place(haybale(hay), x, y, rnd() * 6, 0.85));
    }
    // chimney smoke
    if (quality !== 'low') {
      const rh = Math.min(3, D * 0.55);
      const [cx, cz] = at(W / 3, -D / 5);
      const smoke = chimneySmoke(); smoke.position.set(cx, 1.2 + 2.6 + rh * 0.6 + 1.1, cz); root.add(smoke); anim.push(smoke);
    }
  }

  // Along the palisade: hay, carts, wood piles, crates.
  const W = map.w * TILE; const H = map.h * TILE;
  for (let i = 0; i < 26; i++) {
    const side = i % 4; const t = 0.06 + rnd() * 0.88;
    const x = side === 0 || side === 1 ? t * W : side === 2 ? 1.55 : W - 1.55;
    const y = side === 2 || side === 3 ? t * H : side === 0 ? 1.55 : H - 1.55;
    const tx = Math.floor(x / TILE); const ty = Math.floor(y / TILE);
    if (map.get(tx, ty) !== T.WALL) {
      const nx = Math.floor((side === 2 ? x + 1 : side === 3 ? x - 1 : x) / TILE); const ny = Math.floor((side === 0 ? y + 1 : side === 1 ? y - 1 : y) / TILE);
      if (map.get(nx, ny) === T.FLOOR && map.ground[ny * map.w + nx]) continue; // keep cobbled exits clear
    }
    const rot = side < 2 ? 0 : Math.PI / 2;
    const r = rnd();
    if (r < 0.3) batch.addObject(P.place(haybale(hay), x, y, rnd() * 6, 0.9));
    else if (r < 0.5) batch.addObject(P.place(woodpile(dark), x, y, rot));
    else if (r < 0.65) batch.addObject(P.place(cart(wood, dark), x, y, rot + (rnd() < 0.5 ? 0 : Math.PI)));
    else { batch.addObject(P.place(P.crate(), x, y, rnd(), 0.7)); batch.addObject(P.place(P.barrel(), x + 0.75, y + 0.2, 0, 0.75)); }
  }

  // Market stalls get goods on the counter and a hanging sign.
  for (const n of map.npcs) {
    if (n.type === 'smith') continue;
    const back = n.rot + Math.PI;
    const ox = n.x + Math.sin(n.rot) * -0.2; const oy = n.y + Math.cos(n.rot) * -0.2;
    const g = new THREE.Group();
    const colors = n.type === 'merchant' ? [0xc83a2a, 0x7ac03a, 0xe8b040] : n.type === 'crafter' ? [0x8a5ae0, 0x4ad0c0, 0xe0e0f0] : [0xe0c050, 0xc0c0c8, 0x8a5a30];
    for (let i = 0; i < 3; i++) {
      const bx = -0.75 + i * 0.75;
      g.add(P.mesh(new THREE.BoxGeometry(0.6, 0.12, 0.45), wood, bx, 0.96, 0.9));
      for (let k = 0; k < 7; k++) g.add(P.mesh(new THREE.SphereGeometry(0.075, 7, 5), flat(colors[i], { rough: 0.5 }), bx + (k % 4 - 1.5) * 0.12, 1.07 + (k > 3 ? 0.07 : 0), 0.9 + ((k % 2) - 0.5) * 0.14));
    }
    batch.addObject(P.place(g, ox, oy, back));
  }

  // Banners on the plaza lamp posts.
  const bannerCols = [0x8a1a1e, 0x1e3a8a, 0x8a1a1e, 0x1e5a2a];
  let bi = 0;
  for (const p of map.props) {
    if (p.type !== 'lamppost') continue;
    const g = new THREE.Group();
    const cloth = flat(bannerCols[bi++ % bannerCols.length], { rough: 0.9, side: THREE.DoubleSide });
    g.add(P.mesh(new THREE.BoxGeometry(0.04, 0.04, 0.9), common('iron', { metal: 0.6, rough: 0.5 }), 0, 2.9, 0.45));
    const b = P.mesh(new THREE.PlaneGeometry(0.75, 1.3), cloth, 0, 2.2, 0.55); b.rotation.y = Math.PI / 2; g.add(b);
    g.add(P.mesh(new THREE.CircleGeometry(0.17, 12), flat(0xd8b040, { metal: 0.6, rough: 0.4, side: THREE.DoubleSide }), 0.01, 2.35, 0.55).rotateY(Math.PI / 2));
    batch.addObject(P.place(g, p.x, p.y, (p.x < W / 2 ? 0 : Math.PI)));
  }

  // Rocks and mushrooms under some trees.
  const rock = texMat('town-rock', THEME_TEX.extra.rock, { size: 256 });
  for (const p of map.props) {
    if (p.type !== 'tree' || rnd() > 0.5) continue;
    for (let i = 0; i < 2; i++) {
      const a = rnd() * 6.28; const r = 0.15 + rnd() * 0.25;
      const g = new THREE.Group(); g.add(P.mesh(new THREE.DodecahedronGeometry(r, 0), rock, 0, r * 0.4, 0));
      batch.addObject(P.place(g, p.x + Math.cos(a) * 0.8, p.y + Math.sin(a) * 0.8, rnd() * 6));
    }
  }
}

function flowerBed() {
  const g = new THREE.Group();
  g.add(P.mesh(new THREE.BoxGeometry(0.9, 0.22, 0.4), common('darkwood'), 0, 0.11, 0));
  g.add(P.mesh(new THREE.BoxGeometry(0.82, 0.04, 0.32), flat(0x3a2a1a, { rough: 1 }), 0, 0.22, 0));
  const cols = [0xff5a6a, 0xffd04a, 0xffffff, 0xc06aff];
  for (let i = 0; i < 9; i++) {
    const x = -0.33 + (i % 5) * 0.165; const z = i < 5 ? -0.07 : 0.08;
    g.add(P.mesh(new THREE.SphereGeometry(0.09, 6, 4), flat(0x3a6a2a, { rough: 0.9 }), x, 0.3, z));
    g.add(P.mesh(new THREE.SphereGeometry(0.045, 6, 4), flat(cols[i % 4], { rough: 0.6 }), x + 0.02, 0.38, z));
  }
  return g;
}

function bench(wood) {
  const g = new THREE.Group();
  g.add(P.mesh(new THREE.BoxGeometry(1.2, 0.07, 0.34), wood, 0, 0.45, 0));
  for (const x of [-0.5, 0.5]) g.add(P.mesh(new THREE.BoxGeometry(0.08, 0.45, 0.3), wood, x, 0.22, 0));
  return g;
}

function woodpile(dark) {
  const g = new THREE.Group();
  const bark = texMat('town-bark', THEME_TEX.town.bark, { size: 256 });
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    const l = P.mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 7), bark, (i - (3 - row) / 2) * 0.23, 0.12 + row * 0.2, 0);
    l.rotation.x = Math.PI / 2; g.add(l);
  }
  return g;
}

function haybale(hay) {
  const g = new THREE.Group();
  const b = P.mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.9, 14), hay, 0, 0.5, 0); b.rotation.z = Math.PI / 2; g.add(b);
  return g;
}

function cart(wood, dark) {
  const g = new THREE.Group();
  g.add(P.mesh(new THREE.BoxGeometry(1.7, 0.1, 0.95), wood, 0, 0.62, 0));
  for (const z of [-0.47, 0.47]) g.add(P.mesh(new THREE.BoxGeometry(1.7, 0.35, 0.06), wood, 0, 0.82, z));
  g.add(P.mesh(new THREE.BoxGeometry(0.06, 0.35, 0.95), wood, -0.85, 0.82, 0));
  for (const z of [-0.55, 0.55]) { const w = P.mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 14), dark, 0.2, 0.42, z); w.rotation.x = Math.PI / 2; g.add(w); }
  for (const z of [-0.3, 0.3]) { const h = P.mesh(new THREE.BoxGeometry(1.3, 0.06, 0.06), wood, 1.45, 0.5, z); h.rotation.z = 0.35; g.add(h); }
  for (let i = 0; i < 3; i++) g.add(P.mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), texMat('town-hay', THEME_TEX.extra.hay, { size: 256 }), -0.4 + i * 0.4, 0.92, 0).rotateX(Math.PI / 2));
  return g;
}

let smokeMat = null;
function chimneySmoke() {
  if (!smokeMat) smokeMat = new THREE.SpriteMaterial({ map: softTexture(), color: 0xb8b4ac, transparent: true, depthWrite: false, opacity: 0.4 });
  const g = new THREE.Group(); const N = 9; const seed = Math.random() * 10;
  const puffs = [];
  for (let i = 0; i < N; i++) { const s = new THREE.Sprite(smokeMat.clone()); g.add(s); puffs.push(s); }
  g.userData.tick = (t) => {
    for (let i = 0; i < N; i++) {
      const k = ((t * 0.18 + i / N + seed) % 1);
      const s = puffs[i];
      s.position.set(Math.sin(k * 3 + i) * 0.3 + k * 1.6, k * 5, Math.cos(k * 2 + i) * 0.2 + k * 0.8);
      const sc = 0.5 + k * 2.4; s.scale.set(sc, sc, 1);
      s.material.opacity = Math.sin(k * Math.PI) * 0.32;
    }
  };
  return g;
}

// The fountain's centrepiece: the founding knight, sword raised.
export function fountainStatue() {
  const stone = texMat('town-statue', THEME_TEX.extra.townStatue, { rough: 0.8, size: 256 });
  return buildStatue('hero_knight', stone, 'raise');
}
