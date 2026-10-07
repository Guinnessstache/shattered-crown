// The 3D view: renderer, camera, lighting, the current level and every visible entity.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLevel, cutUniforms } from './level.js';
import { THEME_TEX } from './textures.js';
import { setMaterialQuality } from './materials.js';
import { buildHero, buildMonster, buildMerchant, buildWolf, blobShadow, Animator } from './models.js';
import * as P from './props.js';
import { FX, projectileMesh, lootMesh } from './fx.js';
import { Post } from './post.js';
import { buildSky, buildMountains } from './town.js';
import { softTexture } from './materials.js';
import { MONSTERS, MATERIALS } from '/shared/rules.js';

const LIGHTS = { high: 8, medium: 5, low: 3 };
const tmpV = new THREE.Vector3();

export class World {
  constructor(container, labelLayer) {
    this.container = container; this.labels = labelLayer;
    this.quality = 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // Soft studio reflections so metal armor and blades read as metal.
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 450);
    this.yaw = 0; this.pitch = 0.92; this.dist = 15; this.targetDist = 15;
    this.focus = new THREE.Vector3();
    this.shake = 0;
    this.fx = new FX(this.scene, this.camera, labelLayer);
    this.ents = new Map();
    this.level = null; this.anim = []; this.lightAnchors = []; this.pool = [];
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.5); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.heroLight = new THREE.PointLight(0xffd6a0, 30, 16, 1.6);
    this.scene.add(this.heroLight);
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.motes = new Motes(); this.scene.add(this.motes.points);
    this.sky = null;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    setMaterialQuality(q);
    const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
    this.post.setQuality(q, this.w, this.h);
    if (this.zoneGrade) this.post.setGrade(this.zoneGrade);
    for (const l of this.pool) this.scene.remove(l);
    this.pool = [];
    for (let i = 0; i < LIGHTS[q]; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 13, 1.7);
      l.userData.anchor = null;
      this.scene.add(l); this.pool.push(l);
    }
    // Light count changes recompile shaders; materials pick it up automatically.
  }

  resize() {
    const w = innerWidth; const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Wider view on portrait phones
    this.camera.fov = w < h ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this.fx.setScale(h * this.renderer.getPixelRatio());
    this.w = w; this.h = h;
    this.post?.setSize(w, h);
  }

  // ------------------------------------------------------------ zones
  loadZone(map) {
    this.clearZone();
    const { root, anim, lights } = buildLevel(map, this.quality);
    this.level = root; this.anim = anim; this.lightAnchors = lights;
    this.scene.add(root);
    const town = map.kind === 'town';
    this.town = town;
    const t = THEME_TEX[map.theme] || THEME_TEX.crypt;
    if (this.sky) { this.scene.remove(this.sky); this.sky = null; }
    if (town) {
      // Late-afternoon light: warm low sun, long shadows, sky dome with drifting clouds.
      this.sky = new THREE.Group();
      this.sky.add(buildSky()); this.sky.add(buildMountains(0, 0));
      this.scene.add(this.sky);
      this.scene.background = new THREE.Color(0xc8ccc8);
      this.scene.fog = new THREE.Fog(0xc9cdc8, 40, 140);
      this.hemi.color.set(0xcfe0ff); this.hemi.groundColor.set(0x5a5430); this.hemi.intensity = 1.0;
      this.sun.visible = true; this.sun.castShadow = this.quality !== 'low'; this.sun.intensity = 2.9; this.sun.color.set(0xffdcb0);
      this.sunOffset = [-24, 22, 16];
      this.heroLight.intensity = 0;
      this.renderer.toneMappingExposure = 0.95;
      this.scene.environmentIntensity = 0.35;
    } else {
      this.scene.background = new THREE.Color(t.fog);
      this.scene.fog = new THREE.Fog(t.fog, 15, 42);
      this.hemi.color.set(t.ambient); this.hemi.groundColor.set(0x080604); this.hemi.intensity = 0.6;
      this.sun.visible = true; this.sun.castShadow = false; this.sun.intensity = 0.3; this.sun.color.set(t.key);
      this.sunOffset = [18, 30, 10];
      this.heroLight.intensity = 24; this.heroLight.color.set(0xffd2a0);
      this.renderer.toneMappingExposure = 1.3;
      this.scene.environmentIntensity = 0.14;
    }
    this.zoneGrade = (THEME_TEX[map.theme] || THEME_TEX.crypt).grade;
    if (this.zoneGrade) this.post.setGrade(this.zoneGrade);
    this.motes.setTheme(map.theme, this.quality);
    for (const l of this.pool) { l.userData.anchor = null; l.intensity = 0; }
    this.lightTimer = 0;
  }

  clearZone() {
    for (const id of [...this.ents.keys()]) this.remove(id, true);
    if (this.level) {
      this.scene.remove(this.level);
      this.level.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.level = null;
    this.fx.clear();
  }

  // ------------------------------------------------------------ entities
  add(e, extra = {}) {
    if (this.ents.has(e.id)) return this.ents.get(e.id);
    let obj; let anim = null; let label = null; let r = 0.5;
    const v = { id: e.id, k: e.k, e, x: e.x, y: e.y, rot: e.rot || 0, tx: e.x, ty: e.y, trot: e.rot || 0, hp: e.hp, hpMax: e.hpMax, speed: 0 };
    switch (e.k) {
      case 'p': {
        obj = buildHero(e.cls || 'knight', e.look || {});
        anim = new Animator(obj, { stride: 1.7 });
        r = 0.45;
        if (!extra.me) label = this.label(e.name, 'name');
        break;
      }
      case 'm': {
        obj = buildMonster(e.type, { elite: e.elite });
        anim = new Animator(obj, { stride: e.type === 'ogre' ? 3.4 : 1.4 });
        r = (MONSTERS[e.type]?.r || 0.5) * (e.elite ? 1.25 : 1);
        if (e.elite || e.boss) label = this.label(e.name, e.boss ? 'npc' : 'name');
        v.bar = this.hpBar(obj.userData.height || 1.8);
        obj.add(v.bar);
        break;
      }
      case 'w': {
        obj = buildWolf();
        anim = new Animator(obj, { stride: 1.6 });
        label = this.label(e.name, 'name ally');
        r = 0.45;
        break;
      }
      case 'n': {
        obj = buildMerchant(e.type);
        anim = new Animator(obj);
        label = this.label(e.name, 'npc');
        break;
      }
      case 'l': {
        obj = lootMesh(e);
        const text = e.gold ? `${e.gold} gold` : e.potion ? (e.potion === 'hp' ? 'Health Potion' : 'Mana Potion') : e.mat ? `${e.n > 1 ? `${e.n}× ` : ''}${MATERIALS[e.mat]?.name || e.mat}` : e.item?.name;
        const cls = e.gold ? 'gold' : e.potion ? 'common' : e.mat ? `mat${MATERIALS[e.mat]?.boss ? ' boss' : ''}` : e.item?.rarity;
        label = this.label(text, cls, true);
        label.dataset.id = e.id;
        v.drop = 0;
        r = 0;
        break;
      }
      case 'b': obj = e.type === 'barrel' ? P.barrel() : P.crate(); r = 0.45; break;
      case 'c': obj = P.chest(e.boss); r = 0.6; if (e.open) obj.userData.lid.rotation.x = -1.9; break;
      case 'x': obj = projectileMesh(e.kind); v.vx = e.vx; v.vy = e.vy; break;
      default: return null;
    }
    obj.position.set(e.x, 0, e.y);
    obj.rotation.y = v.rot;
    if (r > 0) { v.shadow = blobShadow(r); obj.add(v.shadow); }
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(obj);
    Object.assign(v, { obj, anim, label });
    if (e.dead && anim) { anim.die(); anim.deadT = 10; }
    this.ents.set(e.id, v);
    return v;
  }

  remove(id, now = false) {
    const v = this.ents.get(id);
    if (!v) return;
    this.ents.delete(id);
    this.scene.remove(v.obj);
    v.label?.remove();
  }

  label(text, cls, clickable = false) {
    const el = document.createElement('div');
    el.className = `lbl ${cls || ''}`;
    el.textContent = text;
    if (!clickable) el.style.pointerEvents = 'none';
    this.labels.appendChild(el);
    return el;
  }

  hpBar(h) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.09), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: false }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.06), new THREE.MeshBasicMaterial({ color: 0xd02828, depthTest: false }));
    fg.position.z = 0.001;
    g.add(bg); g.add(fg);
    g.position.y = h + 0.35; g.renderOrder = 10; bg.renderOrder = 10; fg.renderOrder = 11;
    g.userData.fg = fg; g.visible = false;
    return g;
  }

  // Ground point under a screen position (for mouse aiming).
  groundAt(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, hit) ? hit : null;
  }

  // Monster under the cursor, if any (for target info).
  pick(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    let best = null; let bd = 1e9;
    for (const v of this.ents.values()) {
      if (v.k !== 'm' || v.dead) continue;
      tmpV.set(v.x, (v.obj.userData.height || 1.6) * 0.5, v.y);
      const d = this.raycaster.ray.distanceSqToPoint(tmpV);
      const rr = (v.obj.userData.height || 1.6) * 0.5;
      if (d < rr * rr && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  shakeCam(a) { this.shake = Math.max(this.shake, a); }

  // ------------------------------------------------------------ frame
  render(dt, focusX, focusY) {
    this.renderer.info.reset();
    // Camera follows the hero smoothly
    this.focus.x += (focusX - this.focus.x) * Math.min(1, dt * 10);
    this.focus.z += (focusY - this.focus.z) * Math.min(1, dt * 10);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 8);
    const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
    const sx = (Math.random() - 0.5) * this.shake; const sy = (Math.random() - 0.5) * this.shake;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * this.dist * cp + sx, this.dist * sp + sy, this.focus.z + Math.cos(this.yaw) * this.dist * cp);
    this.camera.lookAt(this.focus.x, 0.9, this.focus.z);
    cutUniforms.uCut.value.set(this.focus.x, this.focus.z, Math.sin(this.yaw), Math.cos(this.yaw));

    // Hero light + sun follow the action
    this.heroLight.position.set(this.focus.x, 3.2, this.focus.z);
    const so = this.sunOffset || [18, 30, 10];
    this.sun.position.set(this.focus.x + so[0], so[1], this.focus.z + so[2]);
    if (this.sky) this.sky.position.set(this.focus.x, 0, this.focus.z);
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);

    // Assign the light pool to the nearest torches
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      const want = this.lightAnchors
        .filter((a) => !this.town || a.night)
        .map((a) => ({ a, d: Math.hypot(a.x - this.focus.x, a.y - this.focus.z) * (a.weak ? 1.7 : 1) }))
        .filter((o) => o.d < 26)
        .sort((p, q) => p.d - q.d).slice(0, this.pool.length);
      const used = new Set();
      for (const l of this.pool) { const keep = want.find((w) => w.a === l.userData.anchor); if (keep) used.add(keep.a); else l.userData.anchor = null; }
      for (const w of want) {
        if (used.has(w.a)) continue;
        const l = this.pool.find((q) => !q.userData.anchor);
        if (!l) break;
        l.userData.anchor = w.a; used.add(w.a);
        l.position.set(w.a.x, w.a.h, w.a.y); l.color.set(w.a.color); l.userData.fade = 0;
      }
    }
    const t = performance.now() / 1000;
    for (const l of this.pool) {
      const a = l.userData.anchor;
      const target = a ? (a.weak ? 6 : this.town ? 9 : 22) : 0;
      l.userData.fade = Math.min(1, (l.userData.fade || 0) + dt * 3);
      const flick = a && !a.weak ? 0.85 + Math.sin(t * 13 + a.x) * 0.06 + Math.sin(t * 23 + a.y) * 0.05 + Math.random() * 0.04 : 1;
      l.intensity = a ? target * flick * l.userData.fade : Math.max(0, l.intensity - dt * 40);
    }
    for (const f of this.anim) {
      if (f.userData.tick) { f.userData.tick(t, dt); continue; }
      if (f.userData.flame) {
        const k = f.userData.seed;
        f.userData.flame.scale.y = 0.75 * f.userData.base * (0.9 + Math.sin(t * 17 + k) * 0.08 + Math.random() * 0.06);
        f.userData.halo.material.opacity = 0.28 + Math.sin(t * 11 + k) * 0.05;
      } else if (f.material?.opacity !== undefined && f.geometry?.type === 'CylinderGeometry') {
        f.material.opacity = 0.4 + Math.sin(t * 2.5) * 0.12;
      } else if (f.userData.water) {
        f.userData.water.material.emissive?.setRGB(0.02, 0.05 + Math.sin(t * 2) * 0.02, 0.1);
      }
    }

    // Elemental shimmer on weapons (held and on the ground) and on afflicted monsters.
    this.elemT = (this.elemT || 0) + dt;
    if (this.elemT > 0.05) {
      this.elemT = 0;
      const tmpV = this._ev || (this._ev = new THREE.Vector3());
      for (const v of this.ents.values()) {
        const w = v.k === 'p' ? v.obj.userData.parts?.weapon : v.k === 'l' ? v.obj : null;
        const el = w?.userData?.el;
        if (el && w.userData.tip && !v.dead) { w.userData.tip.getWorldPosition(tmpV); this.fx.element(el, tmpV.x, tmpV.y, tmpV.z, v.k === 'p' ? 2 : 1, 0.12); }
        if (v.k === 'm' && v.fl && !v.dead) {
          const h = (v.obj.userData.height || 1.4) * 0.6;
          if (v.fl & 1) this.fx.element('fire', v.x, h, v.y, 2, 0.35);
          if (v.fl & 2) this.fx.element('frost', v.x, h, v.y, 1, 0.4);
          if (v.fl & 4) this.fx.element('poison', v.x, h, v.y, 1, 0.3);
        }
      }
    }

    // Entities
    const k = 1 - Math.exp(-dt * 14);
    const camQ = this.camera.quaternion;
    for (const v of this.ents.values()) {
      if (v.k === 'x') { v.x += v.vx * dt; v.y += v.vy * dt; v.obj.position.set(v.x, 0, v.y); v.obj.rotation.y = Math.atan2(v.vx, v.vy); continue; }
      if (v.k === 'p' || v.k === 'm' || v.k === 'n' || v.k === 'w') {
        if (!v.local) {
          const px = v.x; const py = v.y;
          v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k;
          const sp = Math.hypot(v.x - px, v.y - py) / Math.max(dt, 1e-3);
          v.speed += (sp - v.speed) * Math.min(1, dt * 10);
          let dr = v.trot - v.rot; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
          v.rot += dr * Math.min(1, dt * 14);
        }
        v.obj.position.set(v.x, 0, v.y);
        v.obj.rotation.y = v.rot;
        if (v.anim) { v.anim.speed = v.speed; v.anim.update(dt); }
        if (v.bar) {
          const show = !v.dead && v.hp < v.hpMax;
          v.bar.visible = show;
          if (show) { v.bar.quaternion.copy(v.obj.quaternion).invert().multiply(camQ); v.bar.userData.fg.scale.x = Math.max(0.001, v.hp / v.hpMax); v.bar.userData.fg.position.x = -0.43 * (1 - v.hp / v.hpMax); }
        }
      }
      if (v.k === 'l') {
        v.drop = Math.min(1, v.drop + dt * 3);
        v.obj.position.y = Math.sin(v.drop * Math.PI) * 0.6;
        if (v.obj.userData.beam) v.obj.userData.beam.material.opacity = 0.25 + Math.sin(t * 3) * 0.08;
      }
      if (v.k === 'c' && v.opening) { v.opening = Math.min(1, v.opening + dt * 2.5); v.obj.userData.lid.rotation.x = -1.9 * v.opening; }
    }
    this.fx.update(dt, this.w, this.h);
    this.motes.update(dt, t, this.focus);
    this.post.render(dt);
    this.placeLabels();
  }

  placeLabels() {
    for (const v of this.ents.values()) {
      if (!v.label) continue;
      const h = v.k === 'l' ? 0.5 : (v.obj.userData.height || 1.8) * (v.obj.scale.y || 1) + (v.k === 'm' ? 0.6 : 0.35);
      tmpV.set(v.x, h, v.y).project(this.camera);
      const dist = Math.hypot(v.x - this.focus.x, v.y - this.focus.z);
      const hide = tmpV.z > 1 || (v.k === 'l' && (!this.showLootLabels || dist > 14)) || v.dead || (v.k === 'm' && dist > 18);
      if (hide) { if (v.label.style.display !== 'none') v.label.style.display = 'none'; continue; }
      if (v.label.style.display === 'none') v.label.style.display = '';
      const sx = (tmpV.x * 0.5 + 0.5) * this.w; const sy = (-tmpV.y * 0.5 + 0.5) * this.h;
      v.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

// Ambient particles drifting around the hero: crypt dust, cavern spores, infernal embers,
// pollen in the village. One draw call; positions wrap inside a box that follows the camera.
const MOTE = {
  crypt: { n: 260, col: 0xc8c8d8, size: 0.09, rise: 0.05, drift: 0.12, op: 0.5, add: true },
  cavern: { n: 220, col: 0x60f0d0, size: 0.08, rise: 0.12, drift: 0.1, op: 0.7, add: true },
  infernal: { n: 320, col: 0xff7a20, size: 0.1, rise: 1.1, drift: 0.35, op: 0.95, add: true },
  town: { n: 160, col: 0xfff2c0, size: 0.07, rise: 0.04, drift: 0.25, op: 0.6, add: true },
};
class Motes {
  constructor() {
    const N = 340;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 3); const r = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = Math.random(); p[i * 3 + 1] = Math.random(); p[i * 3 + 2] = Math.random(); r[i] = Math.random(); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(r, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: softTexture() }, uCol: { value: new THREE.Color() }, uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uSize: { value: 0.1 }, uRise: { value: 0 }, uDrift: { value: 0 }, uOp: { value: 0.5 }, uScale: { value: 600 } },
      vertexShader: `attribute float aRand; uniform float uT; uniform vec3 uC; uniform float uSize; uniform float uRise; uniform float uDrift; uniform float uScale; varying float vA;
        void main(){
          vec3 box = vec3(26.0, 6.0, 26.0);
          vec3 p = position * box;
          p.y += uT * uRise * (0.6 + aRand);
          p.x += sin(uT * 0.7 + aRand * 20.0) * uDrift * 3.0 + uT * uDrift * 0.3;
          p.z += cos(uT * 0.5 + aRand * 13.0) * uDrift * 3.0;
          vec3 o = uC - box * 0.5; o.y = 0.0;
          p = mod(p - o, box) + o;
          vA = smoothstep(0.0, 0.8, p.y) * (1.0 - smoothstep(4.0, 6.0, p.y)) * (0.5 + 0.5 * sin(uT * (1.0 + aRand * 2.0) + aRand * 30.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * uScale / -mv.z * (0.6 + aRand * 0.8);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uCol; uniform float uOp; varying float vA;
        void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(uCol * 1.6, a * vA * uOp); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  setTheme(theme, quality) {
    const c = MOTE[theme] || MOTE.crypt;
    const u = this.mat.uniforms;
    u.uCol.value.set(c.col); u.uSize.value = c.size; u.uRise.value = c.rise; u.uDrift.value = c.drift; u.uOp.value = c.op;
    const n = quality === 'low' ? Math.round(c.n * 0.35) : quality === 'medium' ? Math.round(c.n * 0.7) : c.n;
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = true;
  }
  update(dt, t, focus) {
    const u = this.mat.uniforms;
    u.uT.value = t; u.uC.value.copy(focus);
    u.uScale.value = innerHeight * 1.1;
  }
}
