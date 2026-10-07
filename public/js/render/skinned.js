// Skinned (motion-captured) heroes: a Mixamo character with a set of clips, played through an
// AnimationMixer. Same interface as the procedural Animator in models.js, so the rest of the
// game doesn't care which kind of hero it's driving.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Bones that make up the upper body: attacks use only these while the legs keep running.
const UPPER = /Spine|Neck|Head|Shoulder|Arm|Hand/;

// Native travel speed of the locomotion clips (metres per second at playback speed 1). Each
// model's own speeds come from manifest.json (measured by the build script); these are defaults.
const NATIVE = { walk: 1.6, run: 4.6 };

// One-shot clips: which part of the clip to play (fractions) and how long it should take at
// minimum. Mocap clips start and end in a neutral stance; trimming the lead-in and the
// recovery keeps attacks snappy without speeding the strike itself up too much.
const SHOT = {
  swing0: { from: 0.08, to: 0.78, min: 0.5 },
  swing1: { from: 0.12, to: 0.72, min: 0.6 },
  swing2: { from: 0.14, to: 0.74, min: 0.62 },
  cleave: { from: 0.05, to: 0.85, min: 0.7 },
  bash: { from: 0.0, to: 1.0, min: 0.42 },
  warcry: { from: 0.1, to: 0.9, min: 1.1 },
  cast: { from: 0.05, to: 0.9, min: 0.6 },
  leap: { from: 0.15, to: 0.8, min: 0.9 },
  hit: { from: 0.0, to: 0.8, min: 0.45 },
};
// When a model has no clip for an action, fall back to a close one.
const ALIAS = { attack: 'swing', frenzy: 'swing', whirlwind: 'cleave', cleave: 'whirlwind', slam: 'leap', throw: 'swing', shoot: 'throw', bash: 'swing', warcry: 'cast', leap: 'swing' };
const VARIANTS = { swing: 3, cast: 3 };
// Moves that use the whole body (a spin, a shove, a roar) play in full even while moving; the
// game holds the hero (nearly) still for them, see ROOT in game.js.
const FULL_BODY = new Set(['cleave', 'whirlwind', 'bash', 'warcry']); // swing0..2, cast0..2 when the model has them

export function buildSkinnedHero(src, clips, height, { speeds = null, shots = null } = {}) {
  const root = new THREE.Group();
  const body = cloneSkinned(src);
  root.add(body);
  const bones = {};
  const mats = [];
  body.traverse((o) => {
    if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o;
    if (o.isMesh) {
      o.castShadow = true; o.frustumCulled = false; // skinned bounds don't follow the pose
      o.material = o.material.clone();
      // Hair, lashes and moustaches: cut out instead of sorted blending (no flicker, casts shadows).
      if (o.material.transparent && o.material.map) { o.material.transparent = false; o.material.alphaTest = 0.45; o.material.depthWrite = true; }
      mats.push(o.material);
    }
  });
  const parts = { root, body, bones, handR: bones.RightHand, handL: bones.LeftHand, foreL: bones.LeftForeArm };
  root.userData = { parts, rig: 'skinned', clips, height, mats, fromGlb: true, speeds: { ...NATIVE, ...(speeds || {}) }, shots: { ...SHOT, ...(shots || {}) } };
  return root;
}

// Hang a game-built weapon/shield (made in metres, +Y up) on a bone of the rig, which lives in
// centimetre space. The fit is described in the character's rest pose (T-pose, facing +Z, its
// left = +X): which world direction the item's +Y and +Z should point along, and an offset
// from the bone in metres. That stays correct whatever the bone's own axes happen to be.
export function attachToBone(bone, obj, { y = [0, 1, 0], z = [0, 0, 1], offset = [0, 0, 0], scale = 1 } = {}) {
  let top = bone; while (top.parent) top = top.parent;
  top.updateWorldMatrix(true, true);
  const rq = new THREE.Quaternion(); bone.getWorldQuaternion(rq);
  const s = new THREE.Vector3(); bone.getWorldScale(s);
  const Y = new THREE.Vector3(...y).normalize(); const Z = new THREE.Vector3(...z).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize(); Z.crossVectors(X, Y).normalize();
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  const inv = rq.clone().invert();
  obj.quaternion.copy(inv).multiply(want);
  obj.position.copy(new THREE.Vector3(...offset).applyQuaternion(inv)).divideScalar(s.x || 1);
  obj.scale.setScalar(scale / (s.x || 1));
  bone.add(obj);
  return obj;
}

// Clips split into the upper body (spine, arms, head) and the rest (hips, legs). Running uses
// both halves; an attack while moving replaces only the upper half, so the legs keep running and
// the arms swing at full strength (instead of half-blending with the run).
const subClipCache = { upper: new WeakMap(), lower: new WeakMap() };
function part(clip, upper) {
  const cache = subClipCache[upper ? 'upper' : 'lower'];
  let m = cache.get(clip);
  if (!m) {
    m = new THREE.AnimationClip(`${clip.name}_${upper ? 'upper' : 'lower'}`, clip.duration, clip.tracks.filter((t) => UPPER.test(t.name.split('.')[0]) === upper));
    cache.set(clip, m);
  }
  return m;
}
const upperBody = (clip) => part(clip, true);
const lowerBody = (clip) => part(clip, false);

export class SkinnedAnimator {
  constructor(model) {
    const u = model.userData;
    this.m = model; this.p = u.parts; this.rig = 'skinned';
    this.mixer = new THREE.AnimationMixer(u.parts.body);
    this.clips = Object.fromEntries(u.clips.map((c) => [c.name, c]));
    this.native = u.speeds || NATIVE; this.shots = u.shots || SHOT;
    this.variant = {};
    this.mats = u.mats.filter((m) => 'emissive' in m);
    this.speed = 0; this.dead = false; this.deadT = 0; this.combo = 0; this.flash = 0; this.flinch = 0;
    this.windup = false; this.stunned = false; this.action = null; this.t = 0;
    this.loco = {};
    for (const n of ['idle', 'walk', 'run']) {
      if (!this.clips[n]) continue;
      const lo = this.mixer.clipAction(lowerBody(this.clips[n]));
      const up = this.mixer.clipAction(upperBody(this.clips[n]));
      for (const a of [lo, up]) { a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); }
      this.loco[n] = { lo, up, each: (f) => { f(lo); f(up); } };
    }
    this.mixer.update(Math.random() * 3); // don't march in lockstep
    this.shot = null; this.deathAction = null;
  }

  play(name, dur) {
    if (this.dead) return;
    if (name === 'charge') { this.shot = { charge: true, t: 0, dur: dur || 0.35 }; return; }
    const clip = this.resolve(name);
    if (!clip) return;
    const spec = this.shots[clip] || { from: 0.05, to: 0.9, min: 0.6 };
    const full = this.clips[clip];
    const lock = FULL_BODY.has(name);
    const moving = this.speed > 0.6 && !lock;
    const c = moving ? upperBody(full) : full;
    const len = Math.max(spec.min, (dur || 0.4) * 1.6);
    const a = this.mixer.clipAction(c);
    this.shot?.action?.fadeOut(0.08);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    a.time = spec.from * full.duration;
    a.timeScale = ((spec.to - spec.from) * full.duration) / len;
    a.setEffectiveWeight(1);
    a.fadeIn(0.06).play();
    this.shot = { action: a, t: 0, dur: len, full: !moving, clip: full, lock };
    this.action = { name, t: 0, dur: len };
  }

  // Pick the clip for a game action: the model's own clip, a variant (swing combo, random cast),
  // or a stand-in from ALIAS.
  resolve(name, depth = 0) {
    if (name === 'swing' && this.clips.swing0) { this.combo = (this.combo + 1) % 3; return this.clips[`swing${this.combo}`] ? `swing${this.combo}` : 'swing0'; }
    if (VARIANTS[name] && this.clips[`${name}0`] && !this.clips[name]) {
      const n = [0, 1, 2].filter((i) => this.clips[`${name}${i}`]);
      let i = n[Math.floor(Math.random() * n.length)];
      if (n.length > 1 && i === this.variant[name]) i = n[(n.indexOf(i) + 1) % n.length]; // never the same twice running
      this.variant[name] = i;
      return `${name}${i}`;
    }
    if (this.clips[name]) return name;
    if (depth < 3 && ALIAS[name]) return this.resolve(ALIAS[name], depth + 1);
    return this.clips.swing0 ? 'swing0' : null;
  }

  hit() {
    this.flash = 0.12;
    // A quick upper-body flinch, only when nothing more important is playing.
    if (!this.shot && !this.dead && this.clips.hit) {
      const a = this.mixer.clipAction(upperBody(this.clips.hit));
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
      a.timeScale = 1.4; a.setEffectiveWeight(0.8); a.fadeIn(0.05).play();
      this.shot = { action: a, t: 0, dur: 0.4, weight: 0.8 };
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.shot?.action?.fadeOut(0.1); this.shot = null;
    const a = this.mixer.clipAction(this.clips.death);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 1.3;
    a.setEffectiveWeight(1); a.fadeIn(0.12).play();
    for (const l of Object.values(this.loco)) l.each((x) => x.fadeOut(0.12));
    this.deathAction = a;
  }

  revive() {
    this.dead = false; this.deadT = 0;
    this.deathAction?.fadeOut(0.2); this.deathAction = null;
    this.p.body.position.y = 0;
    for (const l of Object.values(this.loco)) l.each((x) => { x.reset().fadeIn(0.2).play(); });
  }

  update(dt) {
    this.t += dt;
    if (this.flash > 0) {
      this.flash -= dt;
      const v = Math.max(0, this.flash) * 4;
      for (const m of this.mats) m.emissive.setRGB(v, v * 0.35, v * 0.3);
    }
    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 4) this.p.body.position.y = -(this.deadT - 4) * 0.4; // sink away like the others
      this.mixer.update(dt);
      return;
    }
    // Locomotion blend: idle -> walk -> run by speed, playback rate matched to ground speed.
    const sp = this.speed;
    let wIdle = 1; let wWalk = 0; let wRun = 0;
    if (sp > 0.25) {
      if (sp < 2.2) { const k = (sp - 0.25) / 1.95; wIdle = 1 - k; wWalk = k; } else { const k = Math.min(1, (sp - 2.2) / 1.6); wIdle = 0; wWalk = 1 - k; wRun = k; }
    }
    let S = this.shot;
    // Started an attack standing still, then began to move: hand the legs back to the run.
    if (S?.full && !S.lock && S.action && sp > 0.6) {
      const a = this.mixer.clipAction(upperBody(S.clip));
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
      a.time = S.action.time; a.timeScale = S.action.timeScale; a.setEffectiveWeight(1);
      a.play(); S.action.stop();
      S.action = a; S.full = false;
    }
    // A full-body attack owns the whole skeleton; any attack owns the upper body while it plays.
    const ease = (cur, to) => (cur ?? 1) + (to - (cur ?? 1)) * Math.min(1, dt * 18);
    this.loLo = ease(this.loLo, S?.full && !S.charge ? 0 : 1);
    this.loUp = ease(this.loUp, S && !S.charge ? 1 - (S.weight ?? 1) : 1);
    if (S?.charge) { wIdle = 0; wWalk = 0; wRun = 1; }
    const L = this.loco;
    const set = (l, w, ts) => { if (!l) return; l.lo.setEffectiveWeight(w * this.loLo); l.up.setEffectiveWeight(w * this.loUp); if (ts) { l.lo.timeScale = ts; l.up.timeScale = ts; } };
    set(L.idle, wIdle);
    set(L.walk, wWalk, Math.max(0.6, sp / this.native.walk));
    set(L.run, wRun, S?.charge ? 2.2 : Math.max(0.7, sp / this.native.run));
    if (S) {
      S.t += dt;
      if (this.action) this.action.t = S.t;
      if (S.t >= S.dur) {
        S.action?.fadeOut(0.18);
        this.shot = null; this.action = null;
      }
    }
    this.mixer.update(dt);
  }
}

// Recolour a character's own outfit to match the equipped chest item: texels near the outfit's
// accent hue (and saturated enough not to be skin) are shifted to the item's colour, keeping their
// shading. accent = { hue (0..1), range, minSat }. color = item colour (hex) or null to leave as is.
export function tintOutfit(hero, accent, color) {
  if (!accent || color == null) return;
  const c = new THREE.Color(color); const hsl = {}; c.getHSL(hsl);
  for (const m of hero.userData.mats) {
    if (!m.map) continue;
    m.userData.tint = { uAccent: { value: accent.hue }, uRange: { value: accent.range }, uMinSat: { value: accent.minSat }, uHue: { value: hsl.h }, uSat: { value: hsl.s }, uAmt: { value: hsl.s < 0.12 ? 0.7 : 1 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.tint);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uAccent; uniform float uRange; uniform float uMinSat; uniform float uHue; uniform float uSat; uniform float uAmt;
vec3 sc_rgb2hsv(vec3 c) { vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 sc_hsv2rgb(vec3 c) { vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 hsv = sc_rgb2hsv(diffuseColor.rgb);
  float dh = abs(fract(hsv.x - uAccent + 0.5) - 0.5);
  float k = (1.0 - smoothstep(uRange * 0.6, uRange, dh)) * smoothstep(uMinSat, uMinSat + 0.15, hsv.y) * uAmt;
  vec3 to = sc_hsv2rgb(vec3(uHue, mix(hsv.y * 0.25, hsv.y, clamp(uSat * 1.6, 0.0, 1.0)), hsv.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, to, k); }`);
    };
    m.customProgramCacheKey = () => 'sc-outfit-tint';
    m.needsUpdate = true;
  }
}
