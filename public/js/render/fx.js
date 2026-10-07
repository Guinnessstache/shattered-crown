// Visual effects: sparks, swing trails, damage numbers, telegraphs, projectiles, loot drops.
import * as THREE from 'three';
import { softTexture, glow, flat, common } from './materials.js';
import { weaponMesh, shieldMesh } from './models.js';
import { MATERIALS, itemLook } from '/shared/rules.js';
const MAT_COLORS = Object.fromEntries(Object.entries(MATERIALS).map(([k, v]) => [k, v.color]));

const tmp = new THREE.Vector3();

export class FX {
  constructor(scene, camera, labelLayer) {
    this.scene = scene; this.camera = camera; this.layer = labelLayer;
    this.items = [];
    // Particle pool (one Points object, additive)
    this.max = 600;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.size = new Float32Array(this.max);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.grav = new Float32Array(this.max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.nums = [];
  }

  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }

  emit(x, y, z, n, { color = 0xffc060, speed = 3, up = 2, size = 0.25, life = 0.5, gravity = 6, spread = 1 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2; const s = speed * (0.4 + Math.random() * 0.6) * spread;
      this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = up * (0.4 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity;
    }
  }

  ring(x, z, r, color, n = 40, h = 0.3) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const a = (k / n) * Math.PI * 2;
      this.pos[i * 3] = x + Math.cos(a) * r * 0.2; this.pos[i * 3 + 1] = h; this.pos[i * 3 + 2] = z + Math.sin(a) * r * 0.2;
      this.vel[i * 3] = Math.cos(a) * r * 2.4; this.vel[i * 3 + 1] = 0.5; this.vel[i * 3 + 2] = Math.sin(a) * r * 2.4;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = 0.5; this.life[i] = this.maxLife[i] = 0.4; this.grav[i] = 0;
    }
  }

  // Arc trail for sword swings.
  swing(x, z, rot, { radius = 2.1, arc = 2.0, color = 0xffffff, dir = 1, h = 1.05, dur = 0.22 } = {}) {
    const seg = 16;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array((seg + 1) * 2 * 3); const a = new Float32Array((seg + 1) * 2);
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg; const ang = rot + (t - 0.5) * arc * dir;
      for (let j = 0; j < 2; j++) {
        const rr = j ? radius : radius * 0.45;
        const k = (i * 2 + j);
        p[k * 3] = x + Math.sin(ang) * rr; p[k * 3 + 1] = h + (t - 0.5) * 0.3 * dir; p[k * 3 + 2] = z + Math.cos(ang) * rr;
        a[k] = t * (j ? 1 : 0.3);
      }
      if (i < seg) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(a, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, fade: { value: 1 } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float fade; varying float vA; void main(){ gl_FragColor = vec4(color * vA * fade, vA * fade); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, dur, kind: 'trail' });
  }

  // Expanding red warning circle for boss slams.
  telegraph(x, z, r, dur) {
    const g = new THREE.Group();
    const ringM = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
    for (const m of [ringM, fill]) { m.rotation.x = -Math.PI / 2; g.add(m); }
    g.position.set(x, 0.05, z);
    this.scene.add(g);
    this.items.push({ obj: g, t: 0, dur, kind: 'tell', fill });
  }

  shockwave(x, z, r, color = 0xffa040) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.08, z);
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, dur: 0.45, kind: 'wave', r });
  }

  pillar(x, z, color = 0xffd060) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 8, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, 4, z);
    this.scene.add(m);
    this.items.push({ obj: m, t: 0, dur: 1.4, kind: 'pillar' });
    this.emit(x, 0.3, z, 60, { color, speed: 2, up: 6, size: 0.3, life: 1.2, gravity: -1 });
  }

  // A jagged lightning arc between two points.
  zap(x1, z1, x2, z2, color = 0xc8a8ff) {
    const pts = []; const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n; const j = i === 0 || i === n ? 0 : 0.35;
      pts.push(new THREE.Vector3(x1 + (x2 - x1) * t + (Math.random() - 0.5) * j, 1.1 + (Math.random() - 0.5) * j, z1 + (z2 - z1) * t + (Math.random() - 0.5) * j));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.scene.add(line);
    this.items.push({ obj: line, t: 0, dur: 0.22, kind: 'zap' });
    this.emit(x2, 1.1, z2, 10, { color, speed: 2.5, size: 0.15, life: 0.3, gravity: 0 });
  }

  // Elemental particles from a weapon tip, a loot item or a burning/frozen/poisoned monster.
  element(el, x, y, z, n = 1, spread = 0.08) {
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * spread * 2; const oz = (Math.random() - 0.5) * spread * 2; const oy = (Math.random() - 0.5) * spread;
      if (el === 'fire') this.emit(x + ox, y + oy, z + oz, 1, { color: Math.random() < 0.5 ? 0xff7a20 : 0xffc040, speed: 0.25, up: 1.2, size: 0.16, life: 0.45, gravity: -1.5 });
      else if (el === 'frost') this.emit(x + ox, y + oy, z + oz, 1, { color: Math.random() < 0.6 ? 0xdff6ff : 0x8ad8ff, speed: 0.35, up: 0.3, size: 0.11, life: 0.7, gravity: 0.4 });
      else if (el === 'shock') this.emit(x + ox, y + oy, z + oz, 1, { color: 0xc8a8ff, speed: 1.6, up: 0.4, size: 0.09, life: 0.12, gravity: 0 });
      else if (el === 'poison') this.emit(x + ox, y + oy, z + oz, 1, { color: Math.random() < 0.5 ? 0x6aff3a : 0x3ac020, speed: 0.15, up: -0.2, size: 0.12, life: 0.6, gravity: 2.5 });
    }
  }

  // A glowing disc on the ground that lasts `dur` seconds (Acid Pool, Entangle, Rejuvenation).
  pool(x, z, r, color, dur, { opacity = 0.45, pulse = true } = {}) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.14, r, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 1.8), depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    for (const m of [fill, edge]) { m.rotation.x = -Math.PI / 2; g.add(m); }
    g.position.set(x, 0.06, z);
    this.scene.add(g);
    this.items.push({ obj: g, t: 0, dur, kind: 'pool', fill, edge, base: opacity, pulse });
  }

  // Thorny roots that burst up and hold for `dur` seconds.
  roots(x, z, r, dur) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a6a2a, roughness: 0.9 });
    const n = Math.round(10 + r * 5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const d = Math.sqrt(Math.random()) * r;
      const h = 0.5 + Math.random() * 0.8;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.06 + Math.random() * 0.05, h, 5), mat);
      m.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
      m.rotation.set((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9);
      g.add(m);
    }
    g.position.set(x, 0, z); g.scale.y = 0.01;
    this.scene.add(g);
    this.items.push({ obj: g, t: 0, dur, kind: 'roots' });
    this.pool(x, z, r, 0x3a8a2a, dur, { opacity: 0.25 });
  }

  // A shimmering bubble that follows an object until removed.
  bubble(target, color = 0x8a6aff) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.position.y = 1.0; m.scale.set(1, 1.15, 1);
    target.add(m);
    return m;
  }

  number(x, y, z, text, cls) {
    const el = document.createElement('div');
    el.className = `dmg ${cls || ''}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.nums.push({ el, x, y, z, t: 0, dur: cls?.includes('crit') ? 1.1 : 0.85, dx: (Math.random() - 0.5) * 0.6 });
    if (this.nums.length > 40) { const o = this.nums.shift(); o.el.remove(); }
  }

  update(dt, w, h) {
    // particles
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.03) { this.pos[i * 3 + 1] = 0.03; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 3] *= 0.985 + k * 0.015; this.col[i * 3 + 1] *= 0.97 + k * 0.03; this.col[i * 3 + 2] *= 0.96 + k * 0.04;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
    // timed items
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const k = it.t / it.dur;
      if (it.kind === 'trail') it.obj.material.uniforms.fade.value = 1 - k;
      if (it.kind === 'tell') { it.fill.scale.setScalar(Math.min(1, k)); it.fill.material.opacity = 0.15 + k * 0.3; }
      if (it.kind === 'wave') { it.obj.scale.setScalar(1 + k * it.r); it.obj.material.opacity = 0.8 * (1 - k); }
      if (it.kind === 'zap') it.obj.material.opacity = 1 - k;
      if (it.kind === 'pool') {
        const fade = Math.min(1, it.t / 0.2) * Math.min(1, (it.dur - it.t) / 0.4);
        const pul = it.pulse ? 0.85 + Math.sin(it.t * 6) * 0.15 : 1;
        it.fill.material.opacity = it.base * fade * pul; it.edge.material.opacity = Math.min(1, it.base * 1.8) * fade;
      }
      if (it.kind === 'roots') { const up = Math.min(1, it.t / 0.15); const down = Math.min(1, (it.dur - it.t) / 0.3); it.obj.scale.y = Math.max(0.01, Math.min(up, down)); }
      if (it.kind === 'pillar') { it.obj.material.opacity = 0.5 * (1 - k); it.obj.scale.set(1 - k * 0.5, 1, 1 - k * 0.5); }
      if (k >= 1) { this.scene.remove(it.obj); it.obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.items.splice(i, 1); }
    }
    // floating numbers
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]; n.t += dt; const k = n.t / n.dur;
      if (k >= 1) { n.el.remove(); this.nums.splice(i, 1); continue; }
      tmp.set(n.x + n.dx * k, n.y + k * 1.4, n.z).project(this.camera);
      if (tmp.z > 1) { n.el.style.opacity = 0; continue; }
      const sx = (tmp.x * 0.5 + 0.5) * w; const sy = (-tmp.y * 0.5 + 0.5) * h;
      const pop = k < 0.15 ? 1 + (0.15 - k) * 4 : 1;
      n.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${pop})`;
      n.el.style.opacity = k > 0.6 ? (1 - k) / 0.4 : 1;
    }
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.obj);
    this.items = [];
    for (const n of this.nums) n.el.remove();
    this.nums = [];
    this.life.fill(0);
  }
}

// ---------------------------------------------------------------- projectile & loot visuals
export function projectileMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 4), flat(0x8a6a40));
    shaft.rotation.x = Math.PI / 2; g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), flat(0x9a9a9a, { metal: 0.6 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.4; g.add(tip);
  } else if (kind === 'bolt') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), glow(0xd0b0ff)));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0x8a5aff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(0.8); g.add(halo);
  } else if (kind === 'flask') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff7a30, emissive: 0xff4a10, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 }));
    g.add(b);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0xc8d8e0, roughness: 0.2 }));
    neck.position.y = 0.15; g.add(neck);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xff6020, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(0.7); g.add(halo);
    g.userData.spin = 9;
  } else if (kind === 'thorn') {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 5), new THREE.MeshStandardMaterial({ color: 0x6a9a3a, emissive: 0x2a5a10, emissiveIntensity: 0.6, roughness: 0.7 }));
    t.rotation.x = Math.PI / 2; g.add(t);
  } else {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow(0xffd070)));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: 0xff6020, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(1.1); g.add(halo);
  }
  g.position.y = 1.1;
  return g;
}

const LOOT_GLOW = { common: 0xbbbbbb, magic: 0x4a8aff, rare: 0xffc820, legendary: 0xff7a20 };

export function lootMesh(e) {
  const g = new THREE.Group();
  if (e.gold) {
    const coin = common('gold', { metal: 0.9, rough: 0.3 });
    const n = Math.min(6, 2 + Math.floor(Math.log2(e.gold)));
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), coin);
      c.position.set(Math.cos(i * 2.3) * 0.12, 0.02 + i * 0.012, Math.sin(i * 2.3) * 0.12);
      c.rotation.set(Math.random() * 0.4, 0, Math.random() * 0.4);
      g.add(c);
    }
  } else if (e.mat) {
    const col = new THREE.Color(MAT_COLORS[e.mat] || '#ffffff').getHex();
    for (let i = 0; i < Math.min(3, e.n || 1); i++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + (i === 0 ? 0.04 : 0)), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.2 }));
      c.position.set((i - 1) * 0.12, 0.12, (i % 2) * 0.1); c.rotation.set(i, i * 2, 0); g.add(c);
    }
    if (['sigil', 'tusk', 'silk'].includes(e.mat)) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 3.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 1.6; g.add(beam); g.userData.beam = beam;
    }
  } else if (e.potion) {
    const col = e.potion === 'hp' ? 0xe02030 : 0x3060f0;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.15, transparent: true, opacity: 0.9 }));
    b.position.y = 0.13; g.add(b);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6), flat(0xcfcfcf, { rough: 0.2 })); n.position.y = 0.28; g.add(n);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), flat(0x8a6a40)); cork.position.y = 0.35; g.add(cork);
  } else if (e.item) {
    const it = e.item;
    let m;
    const au = itemLook(it);
    if (it.slot === 'weapon') { m = weaponMesh(it.kind, it.tier, it.rarity, au); m.rotation.set(Math.PI / 2, 0, 0.6); m.position.y = 0.06; if (au.el) { g.userData.el = au.el; g.userData.tip = m.userData.tip; } }
    else if (it.slot === 'offhand') { m = shieldMesh(it.tier, it.rarity, au); m.rotation.x = -Math.PI / 2; m.position.y = 0.05; m.scale.setScalar(0.8); }
    else if (it.slot === 'ring' || it.slot === 'amulet') {
      m = new THREE.Group();
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 14), common('gold', { metal: 0.9, rough: 0.25 }));
      r.rotation.x = Math.PI / 2; r.position.y = 0.03; m.add(r);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), glow(LOOT_GLOW[it.rarity] || 0xffffff)); gem.position.set(0.08, 0.05, 0); m.add(gem);
    } else {
      m = new THREE.Group();
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), common('leather', { color: 0x8a6a4a }));
      sack.scale.set(1, 0.7, 1); sack.position.y = 0.14; m.add(sack);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.26), common('steel', { metal: 0.8, rough: 0.35 }));
      plate.position.y = 0.26; plate.rotation.y = 0.5; m.add(plate);
    }
    g.add(m);
    if (it.rarity !== 'common') {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, it.rarity === 'magic' ? 1.6 : 3.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: LOOT_GLOW[it.rarity], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = it.rarity === 'magic' ? 0.8 : 1.6;
      g.add(beam);
      g.userData.beam = beam;
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
