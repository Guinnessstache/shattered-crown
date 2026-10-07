// Developer gallery: every weapon, shield and hero/armor tier side by side under game lighting.
// Open /dev/gallery.html?view=sword (or axe, mace, staff, shield, variety, heroes, armor).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadModelManifest, weaponMesh, shieldMesh, buildHero } from '/js/render/models.js';
import { loadBakedTextures } from '/js/render/textures.js';
import { animateForged } from '/js/render/forge.js';
import { Post } from '/js/render/post.js';
import { BASES } from '/shared/rules.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') || 'sword';
const VIEWS = ['sword', 'axe', 'mace', 'staff', 'greataxe', 'greatsword', 'maul', 'shield', 'variety', 'heroes', 'armor'];
document.getElementById('bar').innerHTML = VIEWS.map((v) => `<a href="?view=${v}" class="${v === view ? 'on' : ''}">${v}</a>`).join('');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a1612);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x302418, 0.8));
const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(4, 8, 6); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0x8ab0ff, 1.2); rim.position.set(-6, 4, -6); scene.add(rim);
const controls = new OrbitControls(camera, renderer.domElement);
const post = new Post(renderer, scene, camera); post.setQuality('high', innerWidth, innerHeight); post.setGrade({ tint: [1, 1, 1], lift: [0, 0, 0], sat: 1.05, vig: 0.25, bloom: 0.45 });
const labels = document.getElementById('labels'); const tags = [];
const label = (text, x, y, z, color = '#e8dcc4') => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; el.style.color = color; labels.appendChild(el); tags.push({ el, p: new THREE.Vector3(x, y, z) }); };
const RAR = ['common', 'magic', 'rare', 'legendary'];
const RCOL = { common: '#d8d0c0', magic: '#6a9aff', rare: '#ffd040', legendary: '#ff8a30' };
const ELEMS = [[0xff6a1a, 'fire'], [0x8ad8ff, 'frost'], [0xb48aff, 'shock'], [0x6aff3a, 'poison']];
const STATCOL = [0xe0402a, 0x3ad070, 0xe8a030, 0x4a80ff, 0xff3a5a, 0xff5ad0, 0xffe050];
let seedN = 12345;
const nextSeed = () => (seedN = Math.imul(seedN ^ (seedN >>> 15), 2246822519) + 0x9e3779b9 >>> 0);
const look = (kind, tier, rarity, i) => {
  const s = nextSeed();
  const el = rarity !== 'common' && i % 2 === 0 ? ELEMS[(s >>> 3) % 4] : null;
  return { kind, tier, rarity, s, col: rarity === 'common' ? null : el ? el[0] : STATCOL[s % STATCOL.length], el: el ? el[1] : null, col2: rarity === 'rare' || rarity === 'legendary' ? STATCOL[(s >>> 5) % STATCOL.length] : null };
};
const items = [];

await Promise.all([loadModelManifest(), loadBakedTextures()]);

function place(obj, x, y, z = 0) { obj.position.set(x, y, z); obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(obj); items.push(obj); }

if (['sword', 'axe', 'mace', 'staff', 'greataxe', 'greatsword', 'maul'].includes(view)) {
  const big = ['greataxe', 'greatsword', 'maul'].includes(view);
  for (let t = 0; t < 6; t++) for (let r = 0; r < 4; r++) {
    const L = look(view, t, RAR[r], t + r);
    const w = weaponMesh(view, t, RAR[r], L);
    if (big) w.scale.setScalar(0.75);
    place(w, t * 0.85, (3 - r) * 1.9 + (big ? 0.3 : 0), 0);
    if (r === 3) label(BASES[view].names[t], t * 0.85, 3 * 1.9 + 1.75, 0);
  }
  RAR.forEach((r, i) => label(r, -0.7, (3 - i) * 1.9 + 0.5, 0, RCOL[r]));
  camera.position.set(2.1, 3.3, 12.5); controls.target.set(2.1, 3.3, 0);
} else if (view === 'shield') {
  for (let t = 0; t < 6; t++) for (let r = 0; r < 4; r++) {
    const s = shieldMesh(t, RAR[r], look('shield', t, RAR[r], t + r));
    place(s, t * 1.0, (3 - r) * 1.1, 0);
    if (r === 3) label(BASES.shield.names[t], t * 1.0, 3 * 1.1 + 0.6, 0);
  }
  camera.position.set(2.5, 1.6, 8.5); controls.target.set(2.5, 1.6, 0);
} else if (view === 'variety') {
  // Twelve different rare Runed Longswords and Kite Shields: same type, every one different.
  for (let i = 0; i < 10; i++) place(weaponMesh('sword', 3, 'rare', look('sword', 3, 'rare', i)), i * 0.55, 1.2, 0);
  for (let i = 0; i < 10; i++) { const s = shieldMesh(1, i % 3 ? 'magic' : 'rare', look('shield', 1, i % 3 ? 'magic' : 'rare', i)); s.scale.setScalar(0.8); place(s, i * 0.55, 0.0, 0); }
  for (let i = 0; i < 10; i++) place(weaponMesh('axe', 2, 'magic', look('axe', 2, 'magic', i)), i * 0.55, -1.6, 0);
  camera.position.set(2.5, 0.3, 7.5); controls.target.set(2.5, 0.3, 0);
} else {
  const classes = ['knight', 'berserker', 'alchemist', 'druid'];
  const kinds = { knight: 'sword', berserker: 'axe', alchemist: 'staff', druid: 'staff' };
  const tiers = view === 'heroes' ? [0, 2, 3, 5] : [0, 1, 2, 3, 4, 5];
  const DX = 1.15; const DZ = 1.9;
  classes.forEach((c, ci) => tiers.forEach((t, ti) => {
    const r = RAR[Math.min(3, Math.floor(t / 1.5))];
    const lk = (kind) => look(kind, t, r, ti);
    const lookObj = { weapon: lk(kinds[c]), offhand: c === 'knight' ? lk('shield') : null, head: lk('helm'), chest: lk('chest'), hands: lk('gloves'), feet: lk('boots') };
    const h = buildHero(c, lookObj);
    h.rotation.y = 0.3;
    place(h, ti * DX, 0, -ci * DZ);
    label(`${c} t${t}`, h.position.x, 2.2, h.position.z, RCOL[r]);
  }));
  const W = (tiers.length - 1) * DX;
  camera.position.set(W / 2, view === 'heroes' ? 5.2 : 6.2, view === 'heroes' ? 6.2 : 7.6); controls.target.set(W / 2, 0.7, -1.5 * DZ);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x2a241e, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.position.z = -4; floor.receiveShadow = true; scene.add(floor);
  key.shadow.camera.left = -20; key.shadow.camera.right = 20; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10; key.shadow.mapSize.set(2048, 2048);
}
controls.update();

const clock = new THREE.Timer();
function frame() {
  clock.update(); const dt = clock.getDelta(); const t = clock.getElapsed();
  for (const o of items) o.traverse((c) => { if (c.userData.spinners || c.userData.bob) animateForged(c, t); });
  post.render(dt);
  for (const { el, p } of tags) { const v = p.clone().project(camera); el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`; }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });
window.__gallery = { ready: true };
