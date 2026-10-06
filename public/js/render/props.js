// Level props. Static ones are merged per material into a few draw calls (Batcher);
// interactive ones (chests, barrels, stairs glow, flames) stay separate objects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { common, flat, glow, texMat, flameTexture, softTexture } from './materials.js';
import { THEME_TEX } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Batcher {
  constructor() { this.groups = new Map(); }
  add(geo, mat, matrix) {
    let g = this.groups.get(mat);
    if (!g) { g = []; this.groups.set(mat, g); }
    const c = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
    c.applyMatrix4(matrix);
    g.push(c);
  }
  // Add a whole Object3D tree (meshes only).
  addObject(obj) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (o.isMesh) this.add(o.geometry, o.material, o.matrixWorld); });
  }
  build(parent) {
    for (const [mat, list] of this.groups) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true; mesh.castShadow = true;
      parent.add(mesh);
      for (const g of list) g.dispose();
    }
    this.groups.clear();
  }
}

const place = (obj, x, y, rot = 0, s = 1, h = 0) => { obj.position.set(x, h, y); obj.rotation.y = rot; obj.scale.setScalar(s); return obj; };
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

// ---------------------------------------------------------------- geometry helpers
const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s),
  sph: (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r) => new THREE.DodecahedronGeometry(r, 0),
};

// ---------------------------------------------------------------- dungeon pieces
export function torch(theme) {
  const g = new THREE.Group();
  const iron = common('iron', { rough: 0.6, metal: 0.6 });
  g.add(mesh(G.box(0.18, 0.4, 0.08), iron, 0, 2.05, 0.04));
  const arm = mesh(G.box(0.06, 0.06, 0.42), iron, 0, 2.1, 0.22); g.add(arm);
  const cup = mesh(G.cyl(0.13, 0.07, 0.18, 8), iron, 0, 2.2, 0.42); g.add(cup);
  g.add(mesh(G.cyl(0.05, 0.05, 0.22, 6), common('darkwood'), 0, 2.32, 0.42));
  return g;
}

export function flame(color = 0xffa040, scale = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.set(0.42 * scale, 0.75 * scale, 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35, toneMapped: false }));
  halo.scale.set(1.8 * scale, 1.8 * scale, 1);
  const g = new THREE.Group(); g.add(halo); g.add(s);
  g.userData.flame = s; g.userData.halo = halo; g.userData.base = scale; g.userData.seed = Math.random() * 100;
  return g;
}

export function banner(theme) {
  const g = new THREE.Group();
  const cloth = flat(theme === 'infernal' ? 0x3a0a0a : theme === 'cavern' ? 0x2a3a20 : 0x6a1418, { rough: 0.95, side: THREE.DoubleSide });
  const pole = mesh(G.cyl(0.03, 0.03, 1.1, 6), common('darkwood'), 0, 2.6, 0.08); pole.rotation.z = Math.PI / 2; g.add(pole);
  const c = mesh(new THREE.PlaneGeometry(0.9, 1.5, 1, 4), cloth, 0, 1.85, 0.09);
  // ragged hem
  const p = c.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.7) p.setY(i, p.getY(i) + (p.getX(i) === 0 ? 0.15 : 0));
  g.add(c);
  g.add(mesh(G.box(0.3, 0.3, 0.02), flat(0xc8a040, { metal: 0.6, rough: 0.4 }), 0, 2.1, 0.1));
  return g;
}

export function bones() {
  const g = new THREE.Group(); const b = common('bone', { rough: 0.8 });
  for (let i = 0; i < 4; i++) { const m = mesh(G.cyl(0.03, 0.035, 0.5, 5), b, (i - 1.5) * 0.12, 0.04, (i % 2) * 0.1); m.rotation.z = Math.PI / 2; m.rotation.y = i * 0.9; g.add(m); }
  g.add(mesh(G.sph(0.12, 8, 6), b, 0.15, 0.1, -0.12));
  return g;
}

export function skullpile() {
  const g = new THREE.Group(); const b = common('bone', { rough: 0.8 });
  const pts = [[0, 0.12, 0], [0.2, 0.1, 0.05], [-0.18, 0.1, 0.1], [0.05, 0.1, -0.2], [0.02, 0.3, 0.02], [-0.1, 0.1, -0.12]];
  for (const [x, y, z] of pts) { const m = mesh(G.sph(0.13, 8, 6), b, x, y, z); m.scale.set(1, 0.9, 1.1); g.add(m); }
  return g;
}

export function rubble(theme) {
  const g = new THREE.Group();
  const m = texMat(`${theme}-wall`, THEME_TEX[theme]?.wall || THEME_TEX.crypt.wall, { size: 256 });
  for (let i = 0; i < 5; i++) { const r = mesh(G.dodec(0.12 + (i % 3) * 0.07), m, Math.cos(i * 2.4) * 0.35, 0.06, Math.sin(i * 2.4) * 0.35); r.rotation.set(i, i * 2, 0); g.add(r); }
  return g;
}

export function candles() {
  const g = new THREE.Group(); const wax = flat(0xe8e0c8, { rough: 0.7 });
  for (let i = 0; i < 3; i++) g.add(mesh(G.cyl(0.04, 0.045, 0.18 + i * 0.08, 6), wax, (i - 1) * 0.12, (0.18 + i * 0.08) / 2, (i % 2) * 0.08));
  return g;
}

export function mushrooms() {
  const g = new THREE.Group();
  const cap = flat(0x4aa0a0, { emissive: 0x2a8a8a, emissiveIntensity: 0.9, rough: 0.6 });
  const stem = flat(0xd8d0b8);
  for (let i = 0; i < 4; i++) {
    const h = 0.12 + (i % 3) * 0.08; const x = Math.cos(i * 1.7) * 0.2; const z = Math.sin(i * 1.7) * 0.2;
    g.add(mesh(G.cyl(0.025, 0.03, h, 5), stem, x, h / 2, z));
    const c = mesh(G.sph(0.08 + (i % 2) * 0.04, 8, 4), cap, x, h, z); c.scale.y = 0.5; g.add(c);
  }
  return g;
}

export function crystal() {
  const g = new THREE.Group();
  const m = flat(0x8a6aff, { emissive: 0x5a3aff, emissiveIntensity: 1.2, rough: 0.2, metal: 0.1 });
  for (let i = 0; i < 4; i++) { const c = mesh(G.cone(0.08 + i * 0.02, 0.4 + i * 0.15, 5), m, Math.cos(i * 1.6) * 0.15, (0.4 + i * 0.15) / 2, Math.sin(i * 1.6) * 0.15); c.rotation.set(Math.cos(i) * 0.3, 0, Math.sin(i) * 0.3); g.add(c); }
  return g;
}

export function brazier() {
  const g = new THREE.Group(); const iron = common('iron', { metal: 0.6, rough: 0.5 });
  for (let i = 0; i < 3; i++) { const l = mesh(G.cyl(0.03, 0.03, 0.9, 5), iron, Math.cos(i * 2.1) * 0.2, 0.45, Math.sin(i * 2.1) * 0.2); l.rotation.set(Math.sin(i * 2.1) * 0.25, 0, -Math.cos(i * 2.1) * 0.25); g.add(l); }
  g.add(mesh(G.cyl(0.36, 0.22, 0.22, 10), iron, 0, 0.95, 0));
  g.add(mesh(G.cyl(0.3, 0.3, 0.05, 10), glow(0xff5a1a), 0, 1.04, 0));
  return g;
}

export function pillar(theme, h = 3.2) {
  const g = new THREE.Group();
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const m = texMat(`${theme}-pillar`, t.pillar, { size: 256 });
  g.add(mesh(G.box(1.3, 0.4, 1.3), m, 0, 0.2, 0));
  g.add(mesh(G.cyl(0.48, 0.52, h - 0.8, 10), m, 0, h / 2, 0));
  g.add(mesh(G.box(1.2, 0.4, 1.2), m, 0, h - 0.2, 0));
  return g;
}

// Stairs going down: a stone frame around a dark pit with steps fading into darkness.
export function stairsDown(theme) {
  const g = new THREE.Group();
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const stone = texMat(`${theme}-floor`, t.floor, { size: 256 });
  const black = flat(0x000000, { rough: 1 });
  g.add(mesh(G.box(2.6, 0.05, 2.6), black, 0, -0.02, 0));
  for (let i = 0; i < 6; i++) {
    const s = mesh(G.box(1.8, 0.25, 0.42), stone, 0, -0.15 - i * 0.28, -0.9 + i * 0.36);
    s.material = stone; g.add(s);
  }
  const rim = [[0, 1.4, 3, 0.25], [0, -1.4, 3, 0.25], [1.4, 0, 0.25, 3], [-1.4, 0, 0.25, 3]];
  for (const [x, z, w, d] of rim) g.add(mesh(G.box(w, 0.22, d), stone, x, 0.1, z));
  return g;
}

export function stairsUp(theme) {
  const g = new THREE.Group();
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const stone = texMat(`${theme}-floor`, t.floor, { size: 256 });
  for (let i = 0; i < 5; i++) g.add(mesh(G.box(1.8, 0.2 + i * 0.2, 0.45), stone, 0, (0.2 + i * 0.2) / 2, -0.2 - i * 0.45 + 0.9));
  return g;
}

export function stairsGlow(color = 0x7ab0ff) {
  const s = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3, 16, 1, true), new THREE.MeshBasicMaterial({ map: verticalFade(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.55, toneMapped: false }));
  s.position.y = 1.5;
  return s;
}

let vfade = null;
function verticalFade() {
  if (vfade) return vfade;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
  vfade = new THREE.CanvasTexture(c);
  return vfade;
}

// ---------------------------------------------------------------- breakables & chests
export function barrel() {
  const g = new THREE.Group();
  const wood = common('wood', { rough: 0.85 }); const iron = common('iron', { metal: 0.5, rough: 0.5 });
  const body = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 12), wood, 0, 0.48, 0);
  const p = body.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 + 0.12 * (1 - (y / 0.475) ** 2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  body.geometry.computeVertexNormals();
  g.add(body);
  for (const y of [0.15, 0.81]) g.add(mesh(G.cyl(0.39, 0.39, 0.05, 12), iron, 0, y, 0));
  return g;
}

export function crate() {
  const g = new THREE.Group();
  const wood = common('wood', { rough: 0.85 }); const dark = common('darkwood');
  g.add(mesh(G.box(0.78, 0.78, 0.78), wood, 0, 0.39, 0));
  for (const [x, z, w, d] of [[0, 0.4, 0.82, 0.06], [0, -0.4, 0.82, 0.06], [0.4, 0, 0.06, 0.82], [-0.4, 0, 0.06, 0.82]]) {
    g.add(mesh(G.box(w, 0.08, d), dark, x, 0.04, z)); g.add(mesh(G.box(w, 0.08, d), dark, x, 0.74, z));
  }
  return g;
}

export function chest(boss = false) {
  const g = new THREE.Group();
  const wood = common(boss ? 'darkwood' : 'wood'); const trim = boss ? common('gold', { metal: 0.8, rough: 0.35 }) : common('iron', { metal: 0.6, rough: 0.5 });
  const w = boss ? 1.3 : 1.0; const d = boss ? 0.8 : 0.65;
  g.add(mesh(G.box(w, 0.5, d), wood, 0, 0.25, 0));
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) g.add(mesh(G.box(0.08, 0.52, d + 0.04), trim, x, 0.26, 0));
  const lid = new THREE.Group(); lid.position.set(0, 0.5, -d / 2);
  const top = mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 10, 1, false, 0, Math.PI), wood, 0, 0, d / 2);
  top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2; top.rotation.x = 0;
  top.rotation.set(0, 0, Math.PI / 2);
  lid.add(top);
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) { const b = mesh(new THREE.CylinderGeometry(d / 2 + 0.02, d / 2 + 0.02, 0.08, 10, 1, false, 0, Math.PI), trim, x, 0, d / 2); b.rotation.z = Math.PI / 2; lid.add(b); }
  lid.add(mesh(G.box(0.16, 0.2, 0.06), trim, 0, -0.05, d + 0.01));
  g.add(lid);
  g.userData.lid = lid;
  return g;
}

// ---------------------------------------------------------------- town
export function house(w, d, variant) {
  const g = new THREE.Group();
  const T = THEME_TEX.town;
  const plaster = texMat('town-plaster', T.plaster, { size: 256 });
  const timber = texMat('town-timber', T.timber, { size: 256 });
  const stone = texMat('town-stone', T.stone, { size: 256 });
  const roof = texMat(variant === 1 ? 'town-roof2' : 'town-roof', variant === 1 ? T.roof2 : T.roof, { size: 256 });
  const W = w - 0.4; const D = d - 0.4; const H1 = 1.2; const H2 = 2.6;
  const box = (bw, bh, bd, m, y, x = 0, z = 0) => { const b = mesh(G.box(bw, bh, bd), m, x, y, z); uvWorld(b.geometry, bw, bh, bd); g.add(b); };
  box(W, H1, D, stone, H1 / 2);
  box(W - 0.1, H2, D - 0.1, plaster, H1 + H2 / 2);
  // timber frame beams
  for (const x of [-W / 2 + 0.05, 0, W / 2 - 0.05]) for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) box(0.18, H2, 0.12, timber, H1 + H2 / 2, x, z);
  box(W, 0.18, D + 0.02, timber, H1 + 0.1);
  box(W, 0.18, D + 0.02, timber, H1 + H2 - 0.05);
  // gable roof along x
  const rh = Math.min(3, D * 0.55);
  const shape = new THREE.Shape(); shape.moveTo(-D / 2 - 0.5, 0); shape.lineTo(0, rh); shape.lineTo(D / 2 + 0.5, 0); shape.lineTo(-D / 2 - 0.5, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: W + 0.8, bevelEnabled: false });
  rg.translate(0, 0, -(W + 0.8) / 2);
  const rp = rg.attributes.position; const uv = rg.attributes.uv;
  for (let i = 0; i < rp.count; i++) uv.setXY(i, rp.getZ(i) / 3, (rp.getY(i) + Math.abs(rp.getX(i))) / 3);
  const r = new THREE.Mesh(rg, roof); r.rotation.y = Math.PI / 2; r.position.y = H1 + H2; g.add(r);
  const gab = new THREE.Shape(); gab.moveTo(-D / 2 + 0.05, 0); gab.lineTo(0, rh - 0.3); gab.lineTo(D / 2 - 0.05, 0);
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) { const gg = new THREE.Mesh(new THREE.ShapeGeometry(gab), plaster); gg.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2; gg.position.set(x, H1 + H2, 0); g.add(gg); }
  // door + windows on the street side (+z)
  const doorM = common('darkwood');
  g.add(mesh(G.box(1.1, 2.0, 0.12), doorM, 0, 1.0, D / 2 + 0.02));
  const win = flat(0xffc870, { emissive: 0xff9a40, emissiveIntensity: 0.8 });
  for (const x of [-W / 3, W / 3]) { g.add(mesh(G.box(0.8, 0.8, 0.08), win, x, H1 + 1.2, D / 2 + 0.02)); g.add(mesh(G.box(0.95, 0.12, 0.14), doorM, x, H1 + 0.75, D / 2 + 0.04)); }
  // chimney
  g.add(mesh(G.box(0.6, 2, 0.6), stone, W / 3, H1 + H2 + rh * 0.6, -D / 5));
  return g;
}

function uvWorld(geo, w, h, d) {
  const p = geo.attributes.position; const n = geo.attributes.normal; const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)); const ay = Math.abs(n.getY(i));
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    if (ay > 0.5) uv.setXY(i, x / 2, z / 2); else if (ax > 0.5) uv.setXY(i, z / 2, y / 2); else uv.setXY(i, x / 2, y / 2);
  }
}

export function fountain(w, d) {
  const g = new THREE.Group();
  const stone = texMat('town-stone', THEME_TEX.town.stone, { size: 256 });
  const R = Math.min(w, d) / 2 - 0.2;
  const ring = mesh(new THREE.CylinderGeometry(R, R + 0.1, 0.7, 24, 1, true), stone, 0, 0.35, 0); ring.material = stone; g.add(ring);
  const rim = mesh(new THREE.TorusGeometry(R, 0.18, 6, 24), stone, 0, 0.7, 0); rim.rotation.x = Math.PI / 2; g.add(rim);
  const water = mesh(new THREE.CircleGeometry(R - 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x1e4a74, roughness: 0.05, metalness: 0.3, emissive: 0x08203a }), 0, 0.55, 0);
  water.rotation.x = -Math.PI / 2; g.add(water);
  g.add(mesh(G.cyl(0.35, 0.5, 1.8, 10), stone, 0, 0.9, 0));
  g.add(mesh(G.cyl(1.0, 0.5, 0.3, 14), stone, 0, 1.85, 0));
  g.add(mesh(G.cyl(0.15, 0.2, 0.8, 8), stone, 0, 2.3, 0));
  const spout = mesh(G.sph(0.2, 8, 6), glow(0x9ad0ff, 0.6), 0, 2.75, 0); g.add(spout);
  g.userData.water = water;
  return g;
}

export function tree(s = 1, seed = 0) {
  const g = new THREE.Group();
  const bark = texMat('town-bark', THEME_TEX.town.bark, { size: 256 });
  const leaves = [flat(0x2f5a24, { rough: 0.95 }), flat(0x3a6a2a, { rough: 0.95 }), flat(0x24481c, { rough: 0.95 })];
  g.add(mesh(G.cyl(0.18, 0.3, 2.4, 7), bark, 0, 1.2, 0));
  const kind = seed % 2;
  if (kind === 0) {
    for (let i = 0; i < 3; i++) g.add(mesh(G.cone(1.6 - i * 0.4, 1.8, 8), leaves[i % 3], 0, 2.2 + i * 1.0, 0));
  } else {
    for (let i = 0; i < 4; i++) { const b = mesh(G.ico(0.9 + (i % 2) * 0.3, 1), leaves[i % 3], Math.cos(i * 1.9) * 0.6, 2.8 + (i % 2) * 0.6, Math.sin(i * 1.9) * 0.6); g.add(b); }
  }
  g.scale.setScalar(s);
  return g;
}

export function lamppost() {
  const g = new THREE.Group(); const iron = common('iron', { metal: 0.6, rough: 0.5 });
  g.add(mesh(G.cyl(0.08, 0.12, 3.2, 8), iron, 0, 1.6, 0));
  g.add(mesh(G.box(0.4, 0.5, 0.4), flat(0xffd890, { emissive: 0xffb050, emissiveIntensity: 1.5 }), 0, 3.3, 0));
  g.add(mesh(G.cone(0.36, 0.3, 4), iron, 0, 3.7, 0));
  return g;
}

export function palisade(len) {
  const g = new THREE.Group(); const wood = texMat('town-bark', THEME_TEX.town.bark, { size: 256 });
  const n = Math.round(len / 0.45);
  for (let i = 0; i < n; i++) {
    const h = 2.6 + ((i * 7) % 5) * 0.12;
    g.add(mesh(G.cyl(0.2, 0.22, h, 6), wood, -len / 2 + (i + 0.5) * (len / n), h / 2, 0));
    g.add(mesh(G.cone(0.2, 0.4, 6), wood, -len / 2 + (i + 0.5) * (len / n), h + 0.2, 0));
  }
  return g;
}

export function dungeonGate() {
  const g = new THREE.Group();
  const stone = texMat('town-stone', THEME_TEX.town.stone, { size: 256 });
  for (const x of [-2.4, 2.4]) g.add(mesh(G.box(1.2, 4.2, 1.6), stone, x, 2.1, 0));
  g.add(mesh(G.box(6, 1.1, 1.6), stone, 0, 4.6, 0));
  const skull = mesh(G.sph(0.45, 10, 8), common('bone'), 0, 4.6, 0.85); skull.scale.set(1, 1.1, 0.8); g.add(skull);
  for (const x of [-0.17, 0.17]) g.add(mesh(G.sph(0.1, 6, 4), glow(0xff5020), x, 4.68, 1.2));
  const dark = mesh(new THREE.PlaneGeometry(3.6, 4.0), flat(0x000000, { rough: 1 }), 0, 2.0, -0.1); g.add(dark);
  return g;
}

export function stall(color = 0x8a2028) {
  const g = new THREE.Group(); const wood = common('wood');
  const cloth = flat(color, { rough: 0.9, side: THREE.DoubleSide });
  g.add(mesh(G.box(2.4, 0.9, 0.9), wood, 0, 0.45, 0.9));
  for (const x of [-1.15, 1.15]) for (const z of [0.5, -0.6]) g.add(mesh(G.cyl(0.06, 0.06, 2.6, 6), wood, x, 1.3, z));
  const awn = mesh(new THREE.PlaneGeometry(2.6, 1.8), cloth, 0, 2.55, 0); awn.rotation.x = -Math.PI / 2 + 0.25; g.add(awn);
  return g;
}

export function anvil() {
  const g = new THREE.Group(); const iron = common('iron', { metal: 0.7, rough: 0.4 });
  g.add(mesh(G.box(0.5, 0.5, 0.4), common('darkwood'), 0, 0.25, 0));
  g.add(mesh(G.box(0.9, 0.25, 0.35), iron, 0, 0.62, 0));
  const horn = mesh(G.cone(0.15, 0.4, 6), iron, 0.6, 0.65, 0); horn.rotation.z = -Math.PI / 2; g.add(horn);
  return g;
}

export { place, mesh, G, V };
