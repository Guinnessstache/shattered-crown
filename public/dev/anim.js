// Developer viewer for motion-captured heroes: plays each game action on the knight with the
// game's own weapon and shield attached. /dev/anim.html?action=swing&speed=0&t=0.4 freezes a frame
// (used by the screenshot tests); without parameters it loops the chosen action.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Models from '/js/render/models.js';
const { loadModelManifest, buildHero } = Models;
import { SkinnedAnimator } from '/js/render/skinned.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2620);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x302418, 0.9));
const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(4, 8, 6); scene.add(key);
const rim = new THREE.DirectionalLight(0x8ab0ff, 1.2); rim.position.set(-6, 4, -6); scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x4a4236 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const view = q.get('view') || 'front';
const V = { front: [2.2, 1.6, 4.6], side: [5, 1.4, 0.2], back: [-2, 1.8, -4.6], top: [0, 7, 3], face: [0.7, 2.0, 1.6] }[view];
camera.position.set(...V);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, view === 'face' ? 1.85 : 1, 0); controls.update();

await loadModelManifest();
await Models.heroModelsReady;
const cls = q.get('cls') || 'knight';
const WPN = { knight: 'sword', berserker: 'greataxe', alchemist: 'staff', druid: 'staff' };
const look = { weapon: { kind: q.get('weapon') || WPN[cls], tier: Number(q.get('tier') ?? 2), rarity: 'rare', s: 7 } };
const T = Number(q.get('tier') ?? 2); const RR = ['common', 'magic', 'rare', 'rare', 'legendary', 'legendary'][T];
if (q.get('armor') !== '0') for (const [slot, kind, sd] of [['head', 'helm', 3], ['chest', 'chest', 5], ['hands', 'gloves', 11], ['feet', 'boots', 13]]) look[slot] = { kind, tier: T, rarity: RR, s: sd, col: q.get('col') ? parseInt(q.get('col'), 16) : null };
if (cls === 'knight' && !q.get('weapon')) look.offhand = { kind: 'shield', tier: Number(q.get('tier') ?? 2), rarity: 'rare', s: 9 };
if (q.get('old')) Models.skinnedHeroes.enabled = false;
const hero = buildHero(cls, look);
scene.add(hero);
const anim = hero.userData.rig === 'skinned' ? new SkinnedAnimator(hero) : { update() {}, revive() {}, die() {}, hit() {}, play() {}, speed: 0 };
const ACTIONS = ['idle', 'walk', 'run', 'swing', 'cleave', 'bash', 'charge', 'warcry', 'cast', 'throw', 'leap', 'frenzy', 'whirlwind', 'hit', 'death'];
let cur = q.get('action') || 'idle';
const bar = document.getElementById('bar');
bar.innerHTML = ACTIONS.map((a) => `<button data-a="${a}" class="${a === cur ? 'on' : ''}">${a}</button>`).join('');
bar.addEventListener('click', (e) => { const a = e.target.dataset.a; if (a) { cur = a; [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.a === a)); start(); } });
let loopT = 0;
function start() {
  anim.revive(); anim.shot = null; loopT = 0;
  anim.speed = cur === 'walk' ? 1.7 : cur === 'run' ? 4.6 : Number(q.get('speed') || 0);
  if (cur === 'death') anim.die();
  else if (cur === 'hit') anim.hit();
  else if (!['idle', 'walk', 'run'].includes(cur)) anim.play(cur, 0.4);
}
start();
// Frozen frame for tests: advance a fixed amount then stop.
const freeze = q.get('t');
if (freeze != null) { const steps = Math.round(Number(freeze) / (1 / 60)); for (let i = 0; i < steps; i++) anim.update(1 / 60); }
renderer.setAnimationLoop(() => {
  if (freeze == null) {
    const dt = 1 / 60; anim.update(dt); loopT += dt;
    if (!['idle', 'walk', 'run'].includes(cur) && loopT > (cur === 'death' ? 3.5 : 1.4)) start();
  }
  renderer.render(scene, camera);
});
window.__ready = true;
