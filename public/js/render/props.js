// Level props. Static ones are merged per material into a few draw calls (Batcher);
// interactive ones (chests, barrels, stairs glow, flames) stay separate objects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { common, flat, glow, texMat, flameTexture, softTexture } from './materials.js';
import { THEME_TEX, paint } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Batcher {
  constructor({ shadows = true } = {}) { this.groups = new Map(); this.shadows = shadows; }
  add(geo, mat, matrix) {
    let g = this.groups.get(mat);
    if (!g) { g = []; this.groups.set(mat, g); }
    const c = geo.index ? geo.toNonIndexed() : geo.clone();
    const n = c.attributes.position.count;
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!c.attributes.normal) c.computeVertexNormals();
    const keep = mat.vertexColors ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
    for (const k of Object.keys(c.attributes)) if (!keep.includes(k)) c.deleteAttribute(k);
    if (mat.vertexColors && !c.attributes.color) c.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
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
      mesh.receiveShadow = true; mesh.castShadow = this.shadows;
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
  cyl: (rt, rb, h, s = 10, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, hs, open),
  sph: (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  ico: (r, d = 0) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r) => new THREE.DodecahedronGeometry(r, 0),
};

// ---------------------------------------------------------------- dungeon pieces
export function torch(theme) {
  const g = new THREE.Group();
  const iron = common('iron', { rough: 0.55, metal: 0.65 });
  g.add(mesh(G.box(0.22, 0.46, 0.06), iron, 0, 2.05, 0.03));
  g.add(mesh(G.cyl(0.05, 0.05, 0.08, 6), iron, 0, 2.05, 0.08).rotateX(Math.PI / 2));
  const arm = mesh(G.box(0.05, 0.05, 0.42), iron, 0, 2.12, 0.24); arm.rotation.x = -0.35; g.add(arm);
  const cup = mesh(G.cyl(0.14, 0.06, 0.2, 8, 1, true), iron, 0, 2.28, 0.42); g.add(cup);
  for (let i = 0; i < 4; i++) { const p = mesh(G.box(0.025, 0.16, 0.025), iron, Math.cos(i * 1.57) * 0.13, 2.4, 0.42 + Math.sin(i * 1.57) * 0.13); p.rotation.set(Math.sin(i * 1.57) * 0.4, 0, -Math.cos(i * 1.57) * 0.4); g.add(p); }
  g.add(mesh(G.cyl(0.07, 0.05, 0.12, 6), glow(0xff8a30), 0, 2.36, 0.42));
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

// Stairs going down: a carved stone well with corner obelisks, steps sinking into a
// faint glow from below.
export function stairsDown(theme) {
  const g = new THREE.Group();
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const stone = texMat(`${theme}-floor`, t.floor, { size: 256 });
  const trim = texMat(`${theme}-trim`, t.trim || t.pillar, { size: 256 });
  const black = flat(0x000000, { rough: 1 });
  g.add(mesh(G.box(2.6, 0.05, 2.6), black, 0, -2.0, 0));
  for (let i = 0; i < 7; i++) {
    const k = 1 - i / 7;
    const s = mesh(G.box(1.9, 0.26, 0.4), stone, 0, -0.14 - i * 0.27, -0.95 + i * 0.33);
    s.material = i < 5 ? stone : flat(0x0a0806, { rough: 1 }); s.scale.set(1, 1, 1); g.add(s);
    if (i > 2) s.material = flat(new THREE.Color(0x2a2420).multiplyScalar(k).getHex(), { rough: 1 });
  }
  for (const [x, z, w, d] of [[0, 1.3, 2.9, 0.34], [0, -1.3, 2.9, 0.34], [1.3, 0, 0.34, 2.26], [-1.3, 0, 0.34, 2.26]]) g.add(mesh(G.box(w, 0.26, d), trim, x, 0.13, z));
  for (const [x, z] of [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) {
    g.add(mesh(G.box(0.5, 0.3, 0.5), trim, x, 0.15, z));
    g.add(mesh(G.cyl(0.1, 0.17, 1.2, 4), trim, x, 0.9, z).rotateY(Math.PI / 4));
    g.add(mesh(G.cone(0.12, 0.25, 4), trim, x, 1.62, z).rotateY(Math.PI / 4));
    g.add(mesh(G.sph(0.06, 6, 4), glow(0x6aa0ff), x, 1.15, z));
  }
  return g;
}

// Stairs up: steps climbing to a stone arch filled with pale daylight.
export function stairsUp(theme) {
  const g = new THREE.Group();
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const stone = texMat(`${theme}-floor`, t.floor, { size: 256 });
  const trim = texMat(`${theme}-trim`, t.trim || t.pillar, { size: 256 });
  for (let i = 0; i < 5; i++) g.add(mesh(G.box(1.9, 0.18 + i * 0.18, 0.42), stone, 0, (0.18 + i * 0.18) / 2, 0.9 - i * 0.42));
  for (const x of [-1.15, 1.15]) {
    g.add(mesh(G.box(0.42, 3.0, 0.5), trim, x, 1.5, -0.95));
    g.add(mesh(G.box(0.56, 0.3, 0.62), trim, x, 0.15, -0.95));
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.22, 6, 14, Math.PI), trim); arch.position.set(0, 3.0, -0.95); g.add(arch);
  g.add(mesh(new THREE.PlaneGeometry(2.0, 3.0), flat(0x050403, { rough: 1 }), 0, 1.5, -1.16));
  g.add(mesh(new THREE.CircleGeometry(1.0, 14, 0, Math.PI), flat(0x050403, { rough: 1 }), 0, 3.0, -1.16));
  const light = mesh(new THREE.PlaneGeometry(1.9, 3.9), new THREE.MeshBasicMaterial({ map: verticalFade(), color: 0xffd8a0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0, 2.0, -1.1);
  light.rotation.z = Math.PI; g.add(light);
  return g;
}

// Ember light breathing out of the dungeon mouth.
export function gateGlow() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.2), new THREE.MeshBasicMaterial({ map: verticalFade(), color: 0xff4a10, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.y = 1.6;
  return m;
}

export function stairsGlow(color = 0x7ab0ff) {
  const s = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 2.2, 20, 1, true), new THREE.MeshBasicMaterial({ map: verticalFade(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.3, toneMapped: false }));
  s.position.y = 1.1;
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
  const roofKey = ['town-roof', 'town-roof2', 'town-roof3'][variant % 3];
  const roof = texMat(roofKey, [T.roof, T.roof2, T.roof3][variant % 3], { size: 256 });
  const shutterCol = [0x2a5a3a, 0x3a3a6a, 0x7a3a22][variant % 3];
  const W = w - 0.4; const D = d - 0.4; const H1 = 1.2; const H2 = 2.6;
  const box = (bw, bh, bd, m, y, x = 0, z = 0) => { const b = mesh(G.box(bw, bh, bd), m, x, y, z); uvWorld(b.geometry, bw, bh, bd); g.add(b); return b; };
  box(W, H1, D, stone, H1 / 2);
  box(W - 0.1, H2, D - 0.1, plaster, H1 + H2 / 2);
  // timber frame: corner posts, studs, rails and diagonal braces
  const nPost = Math.max(3, Math.round(W / 1.6));
  for (let i = 0; i < nPost; i++) { const x = -W / 2 + 0.05 + i * (W - 0.1) / (nPost - 1); for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) box(0.16, H2, 0.12, timber, H1 + H2 / 2, x, z); }
  for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) for (const z of [-D / 2 + 0.1, 0, D / 2 - 0.1]) box(0.12, H2, 0.16, timber, H1 + H2 / 2, x, z);
  box(W, 0.18, D + 0.02, timber, H1 + 0.1);
  box(W, 0.16, D + 0.02, timber, H1 + H2 * 0.5);
  box(W, 0.18, D + 0.02, timber, H1 + H2 - 0.05);
  for (const sgn of [-1, 1]) for (const z of [-D / 2 + 0.01, D / 2 - 0.01]) {
    const br = mesh(G.box(0.1, Math.hypot(1.2, H2 * 0.5 - 0.2), 0.08), timber, sgn * (W / 2 - 0.65), H1 + 0.18 + (H2 * 0.5 - 0.2) / 2, z); br.rotation.z = sgn * Math.atan2(1.2, H2 * 0.5 - 0.2); g.add(br);
  }
  // gable roof along x with overhang and a ridge beam
  const rh = Math.min(3, D * 0.55);
  const shape = new THREE.Shape(); shape.moveTo(-D / 2 - 0.55, -0.1); shape.lineTo(0, rh); shape.lineTo(D / 2 + 0.55, -0.1); shape.lineTo(D / 2 + 0.55, -0.28); shape.lineTo(0, rh - 0.2); shape.lineTo(-D / 2 - 0.55, -0.28); shape.lineTo(-D / 2 - 0.55, -0.1);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: W + 0.9, bevelEnabled: false });
  rg.translate(0, 0, -(W + 0.9) / 2);
  const rp = rg.attributes.position; const uv = rg.attributes.uv;
  for (let i = 0; i < rp.count; i++) uv.setXY(i, rp.getZ(i) / 3, (rp.getY(i) + Math.abs(rp.getX(i))) / 3);
  const r = new THREE.Mesh(rg, roof); r.rotation.y = Math.PI / 2; r.position.y = H1 + H2; g.add(r);
  box(W + 1.0, 0.16, 0.16, timber, H1 + H2 + rh - 0.02);
  const gab = new THREE.Shape(); gab.moveTo(-D / 2 + 0.05, 0); gab.lineTo(0, rh - 0.3); gab.lineTo(D / 2 - 0.05, 0);
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) {
    const gg = new THREE.Mesh(new THREE.ShapeGeometry(gab), plaster); gg.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2; gg.position.set(x, H1 + H2, 0); g.add(gg);
    // little round gable window
    const gw = mesh(new THREE.CircleGeometry(0.28, 12), flat(0xffc870, { emissive: 0xff9a40, emissiveIntensity: 0.9 }), x + (x < 0 ? -0.01 : 0.01), H1 + H2 + rh * 0.35, 0); gw.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2; g.add(gw);
  }
  // door with frame, step and lantern on the street side (+z)
  const doorM = common('darkwood'); const iron = common('iron', { metal: 0.6, rough: 0.5 });
  g.add(mesh(G.box(1.1, 2.0, 0.12), doorM, 0, 1.0, D / 2 + 0.02));
  g.add(mesh(G.box(1.36, 0.16, 0.2), timber, 0, 2.08, D / 2 + 0.04));
  for (const x of [-0.62, 0.62]) g.add(mesh(G.box(0.14, 2.08, 0.18), timber, x, 1.04, D / 2 + 0.04));
  g.add(mesh(G.box(1.5, 0.14, 0.5), stone, 0, 0.07, D / 2 + 0.25));
  g.add(mesh(G.sph(0.05, 6, 4), iron, 0.38, 1.0, D / 2 + 0.1));
  g.add(mesh(G.box(0.05, 0.05, 0.32), iron, 0.8, 2.25, D / 2 + 0.16));
  g.add(mesh(G.box(0.18, 0.26, 0.18), flat(0xffd890, { emissive: 0xffa040, emissiveIntensity: 2 }), 0.8, 2.05, D / 2 + 0.3));
  // windows: glowing panes, mullions, shutters and flower boxes
  const win = flat(0xffc870, { emissive: 0xff9a40, emissiveIntensity: 0.9 });
  const shut = flat(shutterCol, { rough: 0.85 });
  const cols = [0xff5a6a, 0xffd04a, 0xffffff, 0xc06aff];
  for (const z of [D / 2, -D / 2]) {
    const sz = Math.sign(z);
    for (const x of [-W / 3, W / 3]) {
      const y = H1 + 1.25;
      g.add(mesh(G.box(0.8, 0.85, 0.06), win, x, y, z + sz * 0.03));
      g.add(mesh(G.box(0.06, 0.85, 0.1), timber, x, y, z + sz * 0.05));
      g.add(mesh(G.box(0.8, 0.06, 0.1), timber, x, y, z + sz * 0.05));
      g.add(mesh(G.box(0.98, 0.12, 0.16), timber, x, y + 0.48, z + sz * 0.06));
      for (const s of [-1, 1]) { const sh = mesh(G.box(0.4, 0.9, 0.05), shut, x + s * 0.63, y, z + sz * 0.08); sh.rotation.y = s * sz * 0.25; g.add(sh); }
      if (sz > 0) {
        g.add(mesh(G.box(0.95, 0.18, 0.24), doorM, x, y - 0.55, z + 0.14));
        for (let i = 0; i < 5; i++) { g.add(mesh(G.sph(0.08, 6, 4), flat(0x3a6a2a, { rough: 0.9 }), x - 0.36 + i * 0.18, y - 0.42, z + 0.14)); g.add(mesh(G.sph(0.045, 5, 4), flat(cols[(i + variant) % 4], { rough: 0.6 }), x - 0.34 + i * 0.18, y - 0.35, z + 0.18)); }
      } else g.add(mesh(G.box(0.98, 0.1, 0.16), timber, x, y - 0.48, z + sz * 0.06));
    }
  }
  // chimney with a cap
  g.add(mesh(G.box(0.6, 2.2, 0.6), stone, W / 3, H1 + H2 + rh * 0.6, -D / 5));
  g.add(mesh(G.box(0.74, 0.14, 0.74), stone, W / 3, H1 + H2 + rh * 0.6 + 1.12, -D / 5));
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

let waterNormal = null;
export function fountain(w, d) {
  const g = new THREE.Group();
  const stone = texMat('town-stone', THEME_TEX.town.stone, { size: 256 });
  const R = Math.min(w, d) / 2 - 0.2;
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const a = (i + 0.5) / seg * Math.PI * 2;
    const b = mesh(G.box(2 * Math.PI * R / seg + 0.04, 0.7, 0.36), stone, Math.cos(a) * R, 0.35, Math.sin(a) * R); b.rotation.y = -a + Math.PI / 2; g.add(b);
    const cap = mesh(G.box(2 * Math.PI * R / seg + 0.1, 0.12, 0.5), stone, Math.cos(a) * R, 0.76, Math.sin(a) * R); cap.rotation.y = -a + Math.PI / 2; g.add(cap);
  }
  if (!waterNormal) {
    const { normalMap } = paint('water-n', THEME_TEX.extra.water, 256, true);
    waterNormal = normalMap;
  }
  const wm = new THREE.MeshStandardMaterial({ color: 0x1e4a64, roughness: 0.04, metalness: 0.1, normalMap: waterNormal, envMapIntensity: 2.5, transparent: true, opacity: 0.92 });
  wm.normalScale.set(0.35, 0.35);
  const water = mesh(new THREE.CircleGeometry(R - 0.1, 32), wm, 0, 0.55, 0);
  water.rotation.x = -Math.PI / 2; g.add(water);
  g.add(mesh(G.cyl(0.55, 0.75, 0.5, 12), stone, 0, 0.5, 0));
  g.add(mesh(G.cyl(0.32, 0.42, 1.0, 10), stone, 0, 1.2, 0));
  g.add(mesh(G.cyl(1.1, 0.5, 0.28, 16), stone, 0, 1.82, 0));
  const basinWater = mesh(new THREE.CircleGeometry(0.98, 20), wm, 0, 1.9, 0); basinWater.rotation.x = -Math.PI / 2; g.add(basinWater);
  g.add(mesh(G.cyl(0.36, 0.44, 0.5, 8), stone, 0, 2.18, 0));
  // spill streams from the upper basin to the pool
  const streamM = new THREE.MeshBasicMaterial({ map: verticalFade(), color: 0xbfe4ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const st = mesh(new THREE.PlaneGeometry(0.16, 1.2), streamM, Math.cos(a) * 1.06, 1.3, Math.sin(a) * 1.06); st.rotation.y = -a + Math.PI / 2; g.add(st);
  }
  g.userData.water = water;
  g.userData.tick = (t) => { waterNormal.offset.set(Math.sin(t * 0.3) * 0.05, t * 0.04); streamM.map.offset.y = -t * 0.8; };
  g.userData.statueY = 2.43;
  return g;
}

// Trees: leaf clumps are lumpy icospheres with baked shading (dark underneath, sunlit on
// top) via vertex colours; pines are stacked, drooping tiers.
const leafMats = new Map();
function leafMat(hex) {
  if (!leafMats.has(hex)) leafMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, vertexColors: true }));
  return leafMats.get(hex);
}
function shadeGeo(g, rnd, amt, lo = 0.45, hi = 1.15) {
  const p = g.attributes.position;
  g.computeBoundingBox(); const bb = g.boundingBox;
  const cols = new Float32Array(p.count * 3);
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 1 + (rnd() - 0.5) * amt);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    const t = (p.getY(i) - bb.min.y) / Math.max(0.001, bb.max.y - bb.min.y);
    const c = lo + (hi - lo) * t;
    cols[i * 3] = c; cols[i * 3 + 1] = c; cols[i * 3 + 2] = c * 0.95;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export function tree(s = 1, seed = 0) {
  const g = new THREE.Group();
  let st = (seed * 9301 + 49297) % 233280 || 1; const rnd = () => ((st = (st * 9301 + 49297) % 233280) / 233280);
  const bark = texMat('town-bark', THEME_TEX.town.bark, { size: 256 });
  const greens = [0x3a6a28, 0x4a7a2e, 0x2e5a22, 0x5a7a2a, 0x6a8a30];
  const kind = seed % 3;
  if (kind === 0) {
    // pine
    g.add(mesh(G.cyl(0.14, 0.26, 2.0, 7), bark, 0, 1.0, 0));
    const col = [0x24481e, 0x2a5222, 0x1e3e1a][seed % 3];
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const r = 1.7 - i * 0.34; const h = 1.6 - i * 0.12;
      const cg = shadeGeo(new THREE.ConeGeometry(r, h, 9, 2), rnd, 0.18, 0.35, 1.1);
      const c = mesh(cg, leafMat(col), 0, 1.6 + i * 0.85, 0); c.rotation.y = rnd() * 6; g.add(c);
    }
  } else {
    // broadleaf: trunk, two limbs, 5–7 clumps
    g.add(mesh(G.cyl(0.17, 0.3, 2.4, 7), bark, 0, 1.2, 0));
    for (let i = 0; i < 2; i++) { const l = mesh(G.cyl(0.07, 0.12, 1.3, 5), bark, 0, 2.2, 0); const a = rnd() * 6.28; l.position.set(Math.cos(a) * 0.3, 2.3, Math.sin(a) * 0.3); l.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7); g.add(l); }
    const n = 5 + Math.floor(rnd() * 3);
    const col = greens[seed % greens.length];
    for (let i = 0; i < n; i++) {
      const r = 0.75 + rnd() * 0.55; const a = (i / n) * 6.28 + rnd(); const d = i === 0 ? 0 : 0.55 + rnd() * 0.45;
      const cg = shadeGeo(new THREE.IcosahedronGeometry(r, 1), rnd, 0.3);
      const c = mesh(cg, leafMat(col), Math.cos(a) * d, 2.9 + (i === 0 ? 0.9 : rnd() * 0.9), Math.sin(a) * d); c.scale.y = 0.85; g.add(c);
    }
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
  const stone = texMat('town-rock', THEME_TEX.extra.rock, { size: 256 });
  const block = texMat('town-stone', THEME_TEX.town.stone, { size: 256 });
  for (const x of [-2.4, 2.4]) {
    g.add(mesh(G.box(1.3, 4.0, 1.7), block, x, 2.0, 0));
    g.add(mesh(G.box(1.6, 0.5, 2.0), block, x, 0.25, 0));
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.55, 8, 18, Math.PI), block); arch.position.set(0, 4.0, 0); arch.scale.z = 1.5; g.add(arch);
  for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI; const v = mesh(G.box(0.5, 0.7, 1.75), block, Math.cos(a) * 2.4, 4.0 + Math.sin(a) * 2.4, 0); v.rotation.z = a - Math.PI / 2; g.add(v); }
  const skull = mesh(G.sph(0.55, 12, 10), common('bone'), 0, 6.45, 0.95); skull.scale.set(1, 1.1, 0.8); g.add(skull);
  g.add(mesh(G.box(0.55, 0.3, 0.3), common('bone'), 0, 6.0, 1.1));
  for (const x of [-0.2, 0.2]) g.add(mesh(G.sph(0.12, 6, 4), glow(0xff5020), x, 6.5, 1.36));
  const dark = mesh(new THREE.CircleGeometry(2.4, 18, 0, Math.PI), flat(0x000000, { rough: 1 }), 0, 4.0, -0.2); g.add(dark);
  g.add(mesh(new THREE.PlaneGeometry(4.8, 4.0), flat(0x000000, { rough: 1 }), 0, 2.0, -0.2));
  // braziers flanking the mouth
  for (const x of [-3.6, 3.6]) {
    g.add(mesh(G.cyl(0.25, 0.32, 1.2, 8), block, x, 0.6, 1.0));
    g.add(mesh(G.cyl(0.42, 0.22, 0.3, 10), common('iron', { metal: 0.6, rough: 0.5 }), x, 1.32, 1.0));
    g.add(mesh(G.cyl(0.36, 0.36, 0.05, 10), glow(0xff5a1a), x, 1.45, 1.0));
  }
  // boulders heaped around the gate
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI; const r = 0.5 + (i % 3) * 0.3; g.add(mesh(G.dodec(r), stone, Math.cos(a) * (3.4 + (i % 2)) , r * 0.6 + Math.sin(a) * 2.5, -0.6 - (i % 3) * 0.4)); }
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
