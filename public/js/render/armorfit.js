// Armour on the motion-captured heroes. The tiered armour pieces of the older Blender-built heroes
// (helm, pauldrons, bracers, gloves, thigh plates, greaves, boots: tools/blender/armor_kit.py)
// are re-hung on the Mixamo skeleton's bones, so equipped gear shows on the new models too.
//
// The fit is measured, not hand-tuned: for each joint we compare the old body part (its length and
// how thick it is around the bone) with the Mixamo body (bone length, and how far the vertices
// skinned to that bone sit from it). Each piece is then turned from the old rest pose (limbs
// straight down) to the Mixamo rest pose (T-pose), stretched along the limb by the length ratio
// and around it by the thickness ratio. Rigid pieces on bones is how plate reads at this camera
// distance; chest pieces would need real skinning and are left out.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// old joint -> Mixamo bone, the bone that sets its direction, and the old child joint (if any)
const JOINTS = {
  head: { bone: 'Head', to: 'HeadTop_End', dir: [0, 1, 0] },
  armL: { bone: 'LeftArm', to: 'LeftForeArm', oldTo: 'foreL' },
  armR: { bone: 'RightArm', to: 'RightForeArm', oldTo: 'foreR' },
  foreL: { bone: 'LeftForeArm', to: 'LeftHand', oldTo: 'handL' },
  foreR: { bone: 'RightForeArm', to: 'RightHand', oldTo: 'handR' },
  handL: { bone: 'LeftHand', to: 'LeftHandMiddle1', extent: true },
  handR: { bone: 'RightHand', to: 'RightHandMiddle1', extent: true },
  legL: { bone: 'LeftUpLeg', to: 'LeftLeg', oldTo: 'shinL' },
  legR: { bone: 'RightUpLeg', to: 'RightLeg', oldTo: 'shinR' },
  shinL: { bone: 'LeftLeg', to: 'LeftFoot', ground: true },
  shinR: { bone: 'RightLeg', to: 'RightFoot', ground: true },
};
// armour piece -> the old joint it hangs from (chest pieces need skinning: not here)
const PIECES = {
  helm: 'head', pauldL: 'armL', pauldR: 'armR', bracerL: 'foreL', bracerR: 'foreR', gloveL: 'handL', gloveR: 'handR',
  thighL: 'legL', thighR: 'legR', greaveL: 'shinL', greaveR: 'shinR', bootL: 'shinL', bootR: 'shinR',
};
// End pieces (helm, gloves, boots) keep their shape and only grow with the body's thickness; they
// are still placed using the length ratio (a boot goes down to the sole, a helm up to the skull).
// Pauldrons are sized by the upper arm's thickness. Sleeve-like pieces stretch along the limb.
const END = new Set(['helm', 'gloveL', 'gloveR', 'bootL', 'bootR', 'pauldL', 'pauldR']);
// Largest growth per piece: thickness measured on baggy clothing, hoods and hair overstates the
// body underneath, so outer pieces are kept from ballooning.
const MAX_GROW = { helm: 1.18, pauldL: 1.3, pauldR: 1.3, thighL: 1.35, thighR: 1.35, greaveL: 1.3, greaveR: 1.3, bootL: 1.3, bootR: 1.3 };
// Per-character helm lift (m) where the rig's eye bone sits off the visible eyes (the Brute's heavy brow).
const HELM_LIFT = { hero_berserker_mx: 0.045 };
const SKIP_PARTS = /^(hair|beard|brow|eye|cape)/;
const PIECE_RE = /^([a-zA-Z]+)_t(\d)$/;

const median = (a) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const _v = new THREE.Vector3(); const _d = new THREE.Vector3();
// distance from p to the line through o along unit dir, and how far along it p lies
function radial(p, o, dir) { _d.subVectors(p, o); const t = _d.dot(dir); return { r: _d.addScaledVector(dir, -t).length(), t }; }

// ---- old (Blender-built) hero: joint positions, directions, lengths and limb thickness
const oldCache = new WeakMap();
function measureOld(scene) {
  if (oldCache.has(scene)) return oldCache.get(scene);
  scene.updateMatrixWorld(true);
  const nodes = {}; scene.traverse((o) => { if (o.name && !nodes[o.name]) nodes[o.name] = o; });
  const out = {};
  for (const [j, spec] of Object.entries(JOINTS)) {
    const J = nodes[j]; if (!J) continue;
    const pos = J.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(...(spec.dir || [0, -1, 0]));
    // body-part meshes of this joint (not armour, not hair, not the next joint down)
    const rs = []; let ext = 0; const qs = [];
    for (const c of J.children) {
      if (PIECE_RE.test(c.name) || JOINTS[c.name] || SKIP_PARTS.test(c.name)) continue;
      c.traverse((m) => {
        if (!m.isMesh) return;
        const P = m.geometry.attributes.position; const step = Math.max(1, Math.floor(P.count / 300));
        for (let i = 0; i < P.count; i += step) { _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); const q = radial(_v, pos, dir); if (q.t > 0) { rs.push(q.r); ext = Math.max(ext, q.t); qs.push(q); } }
      });
    }
    const len = spec.oldTo && nodes[spec.oldTo] ? nodes[spec.oldTo].getWorldPosition(new THREE.Vector3()).distanceTo(pos) : ext;
    const rad = median(rs) || 0.06;
    let crown = 0; for (const q of qs) if (q.r < rad * 0.7) crown = Math.max(crown, q.t);
    // eye line (helms are placed relative to it): the old heads have eye meshes
    let eye = 0; let ne = 0;
    for (const c of J.children) if (/^eye/.test(c.name)) c.traverse((m) => { if (m.isMesh) { const b = new THREE.Box3().setFromObject(m); eye += b.getCenter(_v).sub(pos).dot(dir); ne++; } });
    out[j] = { pos, dir, len: len || 0.3, top: crown || len || 0.3, rad, eye: ne ? eye / ne : (crown || len) * 0.55 };
  }
  oldCache.set(scene, out);
  return out;
}

// ---- Mixamo hero: bone rest positions/directions, lengths, and how thick the body is around each bone
const newCache = new Map();
function measureNew(key, body, bones) {
  if (newCache.has(key)) return newCache.get(key);
  body.updateMatrixWorld(true);
  const out = {};
  const verts = {}; // bone index -> sampled rest-pose world positions of vertices mostly skinned to it
  body.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const g = m.geometry; const P = g.attributes.position; const SI = g.attributes.skinIndex; const SW = g.attributes.skinWeight;
    const bonesOf = m.skeleton.bones;
    const step = Math.max(1, Math.floor(P.count / 6000));
    for (let i = 0; i < P.count; i += step) {
      for (let k = 0; k < 4; k++) {
        if (SW.getComponent(i, k) < 0.5) continue;
        const b = bonesOf[SI.getComponent(i, k)]; if (!b) continue;
        // skinned vertices live in bind space: run them through the (rest-pose) skeleton
        const v = new THREE.Vector3().fromBufferAttribute(P, i);
        m.applyBoneTransform(i, v);
        (verts[b.name] ||= []).push(v.applyMatrix4(m.matrixWorld));
      }
    }
  });
  for (const [j, spec] of Object.entries(JOINTS)) {
    const B = bones[spec.bone]; const T = bones[spec.to]; if (!B || !T) continue;
    const pos = B.getWorldPosition(new THREE.Vector3()); const to = T.getWorldPosition(new THREE.Vector3());
    const dir = to.clone().sub(pos).normalize();
    const vs = verts[B.name] || [];
    const rs = []; let ext = 0; const qs = [];
    for (const p of vs) { const q = radial(p, pos, dir); if (q.t > -0.02) { rs.push(q.r); ext = Math.max(ext, q.t); qs.push(q); } }
    let len = pos.distanceTo(to);
    const rad = median(rs) || 0.05;
    // crown: the highest point near the head's centre line (horns and brims stick out sideways)
    let crown = 0; for (const q of qs) if (q.r < rad * 0.7) crown = Math.max(crown, q.t);
    if (spec.extent) len = Math.max(len * 2, ext);
    if (spec.ground) len = pos.y; // knee height above the soles (Mixamo heroes stand on y = 0)
    // top of the head: the measured crown, but hair, hoods and horns may only lift it a little
    const top = j === 'head' ? THREE.MathUtils.clamp(crown || len, len * 0.9, len * 1.35) : len;
    // eye line: the eye bone when the rig has one, else a typical fraction of the head's height
    let eye = top * 0.4;
    const eb = bones.RightEye || bones.LeftEye;
    if (j === 'head' && eb) eye = eb.getWorldPosition(new THREE.Vector3()).sub(pos).dot(dir);
    out[j] = { pos, dir, len, top, eye, rad, world: B.matrixWorld.clone() };
  }
  newCache.set(key, out);
  return out;
}

/**
 * Hang the armour pieces for `look` (tiers per slot) from `oldScene` on the Mixamo hero.
 * dress(obj, L) gives a cloned piece its materials for item look L. Returns the pieces added.
 */
export function fitArmor({ key, hero, bones, oldScene, look, slotOf, dress }) {
  const O = measureOld(oldScene); const N = measureNew(key, hero.userData.parts.body, bones);
  const nodes = {}; oldScene.traverse((o) => { if (o.name && PIECE_RE.test(o.name)) nodes[o.name] = o; });
  const added = [];
  for (const [piece, j] of Object.entries(PIECES)) {
    const slot = slotOf[piece]; const L = look[slot];
    if (!L || !O[j] || !N[j]) continue;
    const src = nodes[`${piece}_t${L.tier ?? 0}`]; if (!src) continue;
    const o = O[j]; const n = N[j];
    const lr = THREE.MathUtils.clamp(n.len / o.len, 0.6, 1.7);
    const rr = THREE.MathUtils.clamp((n.rad / o.rad) * 1.06, 0.7, MAX_GROW[piece] || 1.9);
    // piece relative to its old joint, in the old joint's frame (axis = ±Y); c = its centre
    const rel = new THREE.Matrix4().makeTranslation(-o.pos.x, -o.pos.y, -o.pos.z).multiply(src.matrixWorld);
    const box = new THREE.Box3().setFromObject(src); const c = box.getCenter(new THREE.Vector3()).sub(o.pos);
    const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(o.dir, n.dir));
    const shape = END.has(piece) ? new THREE.Matrix4().makeScale(rr, rr, rr) : new THREE.Matrix4().makeScale(rr, lr, rr);
    const at = new THREE.Vector3(c.x * rr, c.y * lr, c.z * rr); // where the centre goes
    // helms sit on the crown: keep their distance from the top of the head, not from the neck
    if (piece === 'helm') at.y = n.eye + (c.y - o.eye) * rr + (HELM_LIFT[key] || 0);
    const world = new THREE.Matrix4().makeTranslation(n.pos.x, n.pos.y, n.pos.z).multiply(R)
      .multiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)).multiply(shape)
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(rel);
    const local = n.world.clone().invert().multiply(world);
    const obj = src.clone(true);
    obj.matrixAutoUpdate = true;
    local.decompose(obj.position, obj.quaternion, obj.scale);
    obj.visible = true;
    obj.traverse((m) => { m.visible = true; if (m.isMesh) { m.castShadow = true; m.userData.srcMat = m.material?.name || ''; } });
    dress(obj, L);
    bones[JOINTS[j].bone].add(obj);
    added.push(obj);
  }
  return mergePerBone(added);
}

// A full set is ~100 small meshes; merge everything on the same bone with the same material into
// one mesh (pieces are rigid on their bone, so nothing is lost): about 30 draw calls per hero.
function mergePerBone(pieces) {
  const byBone = new Map();
  for (const p of pieces) { const b = p.parent; if (!byBone.has(b)) byBone.set(b, []); byBone.get(b).push(p); }
  const out = [];
  for (const [bone, ps] of byBone) {
    bone.updateMatrixWorld(true);
    const inv = bone.matrixWorld.clone().invert();
    const groups = new Map(); // material -> geometries in bone space
    for (const p of ps) {
      p.updateMatrixWorld(true);
      p.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        const rel = inv.clone().multiply(m.matrixWorld);
        const g = new THREE.BufferGeometry();
        const src = m.geometry;
        g.setAttribute('position', src.attributes.position.clone());
        if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone()); else g.computeVertexNormals();
        g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
        let idx = src.index ? Array.from(src.index.array) : Array.from({ length: src.attributes.position.count }, (_, i) => i);
        if (rel.determinant() < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } // mirrored piece: keep faces outward
        g.setIndex(idx);
        g.applyMatrix4(rel);
        if (!groups.has(m.material)) groups.set(m.material, []);
        groups.get(m.material).push(g);
      });
      bone.remove(p);
    }
    for (const [mat, geos] of groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      for (const g of geos) if (g !== merged) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !mat.transparent;
      mesh.userData.armor = true;
      bone.add(mesh);
      out.push(mesh);
    }
  }
  return out;
}
