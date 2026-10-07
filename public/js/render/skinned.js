// Skinned (motion-captured) heroes: a Mixamo character with a set of clips, played through an
// AnimationMixer. Same interface as the procedural Animator in models.js, so the rest of the
// game doesn't care which kind of hero it's driving.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Bones that make up the upper body: attacks use only these while the legs keep running.
const UPPER = /Spine|Neck|Head|Shoulder|Arm|Hand/;

// Native travel speed of the locomotion clips (metres per second at playback speed 1).
const NATIVE = { walk: 1.69, run: 4.67 };

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
// Game action names (what skills ask for) -> clip.
const ALIAS = { attack: 'swing', frenzy: 'swing', whirlwind: 'cleave', slam: 'leap', throw: 'cast', shoot: 'cast', charge: 'charge' };

export function buildSkinnedHero(src, clips, height) {
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
      mats.push(o.material);
    }
  });
  const parts = { root, body, bones, handR: bones.RightHand, handL: bones.LeftHand, foreL: bones.LeftForeArm };
  root.userData = { parts, rig: 'skinned', clips, height, mats, fromGlb: true };
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

const subClipCache = new WeakMap();
function upperBody(clip) {
  let m = subClipCache.get(clip);
  if (!m) {
    m = new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, clip.tracks.filter((t) => UPPER.test(t.name.split('.')[0])));
    subClipCache.set(clip, m);
  }
  return m;
}

export class SkinnedAnimator {
  constructor(model) {
    const u = model.userData;
    this.m = model; this.p = u.parts; this.rig = 'skinned';
    this.mixer = new THREE.AnimationMixer(u.parts.body);
    this.clips = Object.fromEntries(u.clips.map((c) => [c.name, c]));
    this.mats = u.mats.filter((m) => 'emissive' in m);
    this.speed = 0; this.dead = false; this.deadT = 0; this.combo = 0; this.flash = 0; this.flinch = 0;
    this.windup = false; this.stunned = false; this.action = null; this.t = 0;
    this.loco = {};
    for (const n of ['idle', 'walk', 'run']) {
      if (!this.clips[n]) continue;
      const a = this.mixer.clipAction(this.clips[n]);
      a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      this.loco[n] = a;
    }
    this.mixer.update(Math.random() * 3); // don't march in lockstep
    this.shot = null; this.deathAction = null;
  }

  play(name, dur) {
    if (this.dead) return;
    let clip = ALIAS[name] || name;
    if (clip === 'swing') { this.combo = (this.combo + 1) % 3; clip = `swing${this.combo}`; }
    if (clip === 'charge') { this.shot = { charge: true, t: 0, dur: dur || 0.35 }; return; }
    if (!this.clips[clip]) clip = 'swing0';
    const spec = SHOT[clip] || { from: 0, to: 1, min: 0.5 };
    const full = this.clips[clip];
    const moving = this.speed > 0.6;
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
    this.shot = { action: a, t: 0, dur: len, full: !moving };
    this.action = { name, t: 0, dur: len };
  }

  hit() {
    this.flash = 0.12;
    // A quick upper-body flinch, only when nothing more important is playing.
    if (!this.shot && !this.dead && this.clips.hit) {
      const a = this.mixer.clipAction(upperBody(this.clips.hit));
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
      a.timeScale = 1.4; a.setEffectiveWeight(0.8); a.fadeIn(0.05).play();
      this.shot = { action: a, t: 0, dur: 0.4 };
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.shot?.action?.fadeOut(0.1); this.shot = null;
    const a = this.mixer.clipAction(this.clips.death);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = 1.3;
    a.setEffectiveWeight(1); a.fadeIn(0.12).play();
    for (const l of Object.values(this.loco)) l.fadeOut(0.12);
    this.deathAction = a;
  }

  revive() {
    this.dead = false; this.deadT = 0;
    this.deathAction?.fadeOut(0.2); this.deathAction = null;
    this.p.body.position.y = 0;
    for (const l of Object.values(this.loco)) { l.reset().play(); }
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
    const S = this.shot;
    // A full-body attack owns the whole skeleton while it plays.
    const target = S?.full && !S.charge ? 0 : 1;
    this.locoMul = (this.locoMul ?? 1) + (target - (this.locoMul ?? 1)) * Math.min(1, dt * 18);
    const lw = this.locoMul;
    if (S?.charge) { wIdle = 0; wWalk = 0; wRun = 1; }
    const L = this.loco;
    if (L.idle) L.idle.setEffectiveWeight(wIdle * lw);
    if (L.walk) { L.walk.setEffectiveWeight(wWalk * lw); L.walk.timeScale = Math.max(0.6, sp / NATIVE.walk); }
    if (L.run) { L.run.setEffectiveWeight(wRun * lw); L.run.timeScale = S?.charge ? 2.2 : Math.max(0.7, sp / NATIVE.run); }
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
