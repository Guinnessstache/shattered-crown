// Item icons rendered from small 3D models into images (cached), like a console RPG inventory.
import * as THREE from 'three';
import { weaponMesh, shieldMesh } from './models.js';
import { common, glow } from './materials.js';

const SIZE = 96;
let renderer = null; let scene; let camera;
const cache = new Map();
const TIER_METAL = [0x7a5a3a, 0x8a8c90, 0xb8bcc4, 0x6a86b0, 0x3a3436, 0xd8a040];
const GEM = { common: 0xdddddd, magic: 0x4a8aff, rare: 0xffc820, legendary: 0xff7a20 };

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(2, 3, 4); scene.add(d);
  const r = new THREE.DirectionalLight(0xffc080, 1.2); r.position.set(-3, 1, -2); scene.add(r);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
}

function armorPiece(slot, tier) {
  const g = new THREE.Group();
  const m = tier === 0 ? common('leather', { color: 0xc89a70 }) : common('steel', { metal: 0.75, rough: 0.35, color: TIER_METAL[tier] });
  const trim = common('gold', { metal: 0.85, rough: 0.3 });
  if (slot === 'chest') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.75, 10), m); body.scale.z = 0.6; g.add(body);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), m); p.position.set(sx * 0.45, 0.3, 0); g.add(p); }
    if (tier >= 2) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.3), trim); b.position.y = -0.28; g.add(b); }
  } else if (slot === 'head') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), m));
    if (tier >= 2) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.36, 0.45, 14, 1, true), m); f.position.y = -0.18; g.add(f); const slit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0 })); slit.position.set(0, -0.08, 0.37); g.add(slit); }
    else { const n = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.35, 0.07), m); n.position.set(0, -0.12, 0.38); g.add(n); }
    if (tier >= 3) for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 4), trim); w.position.set(sx * 0.4, 0.3, 0); w.rotation.z = -sx * 0.9; g.add(w); }
    g.position.y = 0.1;
  } else if (slot === 'hands') {
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.2), m); g.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.12), m); f.position.set(-0.15 + i * 0.1, 0.34, 0); g.add(f); }
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), m); th.position.set(0.26, 0.05, 0); th.rotation.z = -0.6; g.add(th);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.25, 10), m); cuff.position.y = -0.32; g.add(cuff);
    g.rotation.z = 0.3;
  } else if (slot === 'feet') {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.55, 10), m); leg.position.y = 0.15; g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.6), m); foot.position.set(0, -0.15, 0.15); g.add(foot);
    g.rotation.y = -0.8;
  }
  return g;
}

function jewel(slot, rarity) {
  const g = new THREE.Group();
  const gold = common('gold', { metal: 0.9, rough: 0.25 });
  if (slot === 'ring') {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), gold); r.rotation.x = 1.1; g.add(r);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), glow(GEM[rarity])); gem.position.set(0, 0.32, 0.12); g.add(gem);
  } else {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 24, Math.PI * 1.2), gold); chain.rotation.z = Math.PI * 1.9; chain.position.y = 0.15; g.add(chain);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 6), gold); p.rotation.x = Math.PI / 2; p.position.y = -0.25; g.add(p);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), glow(GEM[rarity])); gem.position.set(0, -0.25, 0.06); g.add(gem);
  }
  return g;
}

export function itemIcon(it) {
  if (!it) return '';
  const key = `${it.slot}:${it.kind}:${it.tier}:${it.rarity}`;
  if (cache.has(key)) return cache.get(key);
  if (!renderer) setup();
  let obj;
  if (it.slot === 'weapon') { obj = weaponMesh(it.kind, it.tier, it.rarity); obj.rotation.z = -Math.PI / 4; obj.position.set(0.3, -0.3, 0); if (it.kind === 'staff') { obj.scale.setScalar(0.72); obj.position.set(0.35, -0.2, 0); } }
  else if (it.slot === 'offhand') obj = shieldMesh(it.tier, it.rarity);
  else if (it.slot === 'ring' || it.slot === 'amulet') obj = jewel(it.slot, it.rarity);
  else obj = armorPiece(it.slot, it.tier);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length();
  const pivot = new THREE.Group(); pivot.add(obj); obj.position.sub(c);
  pivot.rotation.y = it.slot === 'weapon' ? 0.4 : 0.35;
  scene.add(pivot);
  camera.position.set(0, s * 0.25, s * 1.9); camera.lookAt(0, 0, 0);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(pivot);
  cache.set(key, url);
  return url;
}
