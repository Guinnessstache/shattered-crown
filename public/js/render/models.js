// Characters and monsters: low-poly segmented rigs (PSP-era style) with procedural animation.
// Every rig exposes the same named joints, so models exported from Blender with matching node
// names (see /models/README) drop straight in and use the same animator.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { common, flat, glow, blobShadowMaterial } from './materials.js';

const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, s = 8, ...rest) => new THREE.CylinderGeometry(rt, rb, h, s, ...rest),
  sph: (r, w = 10, h = 8, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
  cap: (r, l, s = 8) => new THREE.CapsuleGeometry(r, l, 3, s),
};
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
const A = (parent, m) => { parent.add(m); return m; };
const joint = (name, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); return g; };

// ---------------------------------------------------------------- palettes
const TIER_METAL = [0x7a5a3a, 0x8a8c90, 0xb8bcc4, 0x6a86b0, 0x3a3436, 0xd8a040];
const TIER_TRIM = [0x4a3420, 0x5a5c60, 0xd0b060, 0xd8d8e0, 0xa02020, 0xff7020];
const RARITY_GLOW = { magic: 0x3a7aff, rare: 0xffc020, legendary: 0xff6010 };

function armorMat(tier = 1) {
  const leather = tier === 0;
  return leather ? common('leather', { rough: 0.8, color: 0xffd8b0 }) : common('steel', { metal: 0.75, rough: 0.38, color: TIER_METAL[tier] });
}
function trimMat(tier = 1) { return tier >= 2 ? common('gold', { metal: 0.85, rough: 0.3, color: TIER_TRIM[tier] }) : common('iron', { metal: 0.6, rough: 0.5, color: TIER_TRIM[tier] }); }

// ---------------------------------------------------------------- weapons & shields
export function weaponMesh(kind = 'sword', tier = 0, rarity = 'common') {
  const g = new THREE.Group();
  const blade = common('steel', { metal: 0.85, rough: 0.25, color: tier >= 4 ? 0x5a5a66 : 0xd8dce4 });
  const grip = common('leather', { color: 0x6a4428 });
  const guard = trimMat(Math.max(1, tier));
  const glowC = RARITY_GLOW[rarity];
  const len = 0.9 + tier * 0.06;
  if (kind === 'sword' || kind === 'none') {
    g.add(M(G.cyl(0.03, 0.035, 0.22, 6), grip, 0, 0, 0));
    g.add(M(G.box(0.32 + tier * 0.03, 0.05, 0.07), guard, 0, 0.12, 0));
    const b = M(G.box(0.085, len, 0.022), blade, 0, 0.14 + len / 2, 0); g.add(b);
    const tip = M(G.cone(0.06, 0.16, 4), blade, 0, 0.14 + len + 0.08, 0); tip.rotation.y = Math.PI / 4; tip.scale.z = 0.3; g.add(tip);
    g.add(M(G.sph(0.045, 6, 4), guard, 0, -0.13, 0));
    if (glowC) { const e = M(G.box(0.03, len * 0.9, 0.03), glow(glowC, 0.8), 0, 0.14 + len / 2, 0); g.add(e); }
  } else if (kind === 'axe') {
    g.add(M(G.cyl(0.035, 0.04, 1.0, 6), common('wood'), 0, 0.35, 0));
    const head = new THREE.Shape(); head.moveTo(0, -0.12); head.quadraticCurveTo(0.34, -0.26, 0.4, 0); head.quadraticCurveTo(0.34, 0.26, 0, 0.14); head.lineTo(0, -0.12);
    const hg = new THREE.ExtrudeGeometry(head, { depth: 0.03, bevelEnabled: false }); hg.translate(0, 0, -0.015);
    const h = M(hg, blade, 0.03, 0.78, 0); g.add(h);
    if (tier >= 3) { const h2 = M(hg, blade, -0.03, 0.78, 0); h2.rotation.y = Math.PI; g.add(h2); }
    if (glowC) g.add(M(G.box(0.02, 0.4, 0.04), glow(glowC, 0.8), 0.42, 0.78, 0));
  } else if (kind === 'mace') {
    g.add(M(G.cyl(0.035, 0.04, 0.85, 6), common('darkwood'), 0, 0.3, 0));
    g.add(M(G.sph(0.14 + tier * 0.01, 8, 6), blade, 0, 0.8, 0));
    for (let i = 0; i < 6; i++) { const s = M(G.cone(0.04, 0.14, 4), blade, 0, 0.8, 0); const a = i / 6 * Math.PI * 2; s.position.set(Math.cos(a) * 0.15, 0.8, Math.sin(a) * 0.15); s.rotation.set(0, -a, Math.PI / 2); g.add(s); }
    if (glowC) g.add(M(G.sph(0.08, 6, 4), glow(glowC, 0.9), 0, 0.8, 0));
  } else if (kind === 'club') {
    const c = M(G.cyl(0.14, 0.05, 1.1, 7), common('wood'), 0, 0.45, 0); g.add(c);
    for (let i = 0; i < 5; i++) g.add(M(G.cone(0.035, 0.12, 4), common('iron'), Math.cos(i * 1.3) * 0.12, 0.7 + i * 0.05, Math.sin(i * 1.3) * 0.12));
  } else if (kind === 'dagger') {
    g.add(M(G.cyl(0.025, 0.03, 0.14, 6), grip, 0, 0, 0));
    g.add(M(G.box(0.06, 0.4, 0.02), common('iron', { metal: 0.6, rough: 0.4 }), 0, 0.27, 0));
  } else if (kind === 'bow') {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, -0.3, 0.14), new THREE.Vector3(0, 0, 0.18), new THREE.Vector3(0, 0.3, 0.14), new THREE.Vector3(0, 0.6, 0)]);
    g.add(M(new THREE.TubeGeometry(curve, 12, 0.025, 5), common('darkwood')));
    const s = M(G.cyl(0.004, 0.004, 1.2, 3), flat(0xddddcc), 0, 0, 0); g.add(s);
  } else if (kind === 'staff') {
    const wood = common(tier >= 3 ? 'darkwood' : 'wood');
    g.add(M(G.cyl(0.03, 0.035, 1.7, 7), wood, 0, 0.35, 0));
    // gnarled head: a cradle of prongs around a crystal
    const cryC = glowC || [0x7ad0ff, 0x7ad0ff, 0x9a7aff, 0xff9a40, 0xff5a5a, 0xffd060][tier];
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const pr = M(G.cone(0.03, 0.26, 4), wood, Math.cos(a) * 0.06, 1.28, Math.sin(a) * 0.06); pr.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); g.add(pr); }
    const cry = M(new THREE.OctahedronGeometry(0.08), glow(cryC, 0.9), 0, 1.3, 0); cry.scale.y = 1.6; g.add(cry);
    g.add(M(G.cyl(0.045, 0.045, 0.06, 7), guard, 0, 1.18, 0));
    g.add(M(G.cyl(0.04, 0.04, 0.05, 7), guard, 0, -0.45, 0));
  } else if (kind === 'hammer') {
    g.add(M(G.cyl(0.03, 0.035, 0.6, 6), common('wood'), 0, 0.2, 0));
    g.add(M(G.box(0.24, 0.12, 0.12), common('iron', { metal: 0.7 }), 0, 0.5, 0));
  }
  return g;
}

export function shieldMesh(tier = 0, rarity = 'common') {
  const g = new THREE.Group();
  const face = tier === 0 ? common('wood') : armorMat(tier);
  const trim = trimMat(Math.max(1, tier));
  if (tier <= 0) {
    g.add(M(G.cyl(0.32, 0.32, 0.06, 12), face, 0, 0, 0).rotateX(Math.PI / 2));
    g.add(M(G.sph(0.08, 8, 6), trim, 0, 0, 0.04));
  } else {
    const s = new THREE.Shape(); const w = 0.32 + tier * 0.02; const h = 0.5 + tier * 0.04;
    s.moveTo(-w, h * 0.55); s.lineTo(w, h * 0.55); s.quadraticCurveTo(w, -h * 0.2, 0, -h); s.quadraticCurveTo(-w, -h * 0.2, -w, h * 0.55);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 1 });
    geo.translate(0, 0, -0.025);
    g.add(M(geo, face));
    const emb = new THREE.Shape(); emb.moveTo(-0.05, 0.25); emb.lineTo(0.05, 0.25); emb.lineTo(0.05, 0.05); emb.lineTo(0.2, 0.05); emb.lineTo(0.2, -0.05); emb.lineTo(0.05, -0.05); emb.lineTo(0.05, -0.35); emb.lineTo(-0.05, -0.35); emb.lineTo(-0.05, -0.05); emb.lineTo(-0.2, -0.05); emb.lineTo(-0.2, 0.05); emb.lineTo(-0.05, 0.05);
    const eg = new THREE.ExtrudeGeometry(emb, { depth: 0.02, bevelEnabled: false });
    const em = M(eg, RARITY_GLOW[rarity] ? glow(RARITY_GLOW[rarity], 0.9) : flat(0x8a1a20, { rough: 0.6 }), 0, 0.02, 0.05);
    em.scale.setScalar(0.9 + tier * 0.05);
    g.add(em);
  }
  return g;
}

// ---------------------------------------------------------------- humanoid rig
/**
 * Build a humanoid with joints: hips, torso, head, armL/armR (shoulders), foreL/foreR (elbows),
 * handL/handR, legL/legR (hips), shinL/shinR (knees). Faces +Z. Feet at y=0.
 */
function humanoid(o) {
  const s = o.scale || 1;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); body.scale.setScalar(s);
  const hipY = o.hipY || 0.95;
  const hips = joint('hips', 0, hipY, 0); body.add(hips);
  const torso = joint('torso', 0, 0.05, 0); hips.add(torso);
  const head = joint('head', 0, o.neckY || 0.62, 0); torso.add(head);
  const sh = o.shoulderW || 0.27;
  const armL = joint('armL', sh, (o.neckY || 0.62) - 0.08, 0); torso.add(armL);
  const armR = joint('armR', -sh, (o.neckY || 0.62) - 0.08, 0); torso.add(armR);
  const ua = o.upperArm || 0.32; const fa = o.foreArm || 0.3;
  const foreL = joint('foreL', 0, -ua, 0); armL.add(foreL);
  const foreR = joint('foreR', 0, -ua, 0); armR.add(foreR);
  const handL = joint('handL', 0, -fa, 0.02); foreL.add(handL);
  const handR = joint('handR', 0, -fa, 0.02); foreR.add(handR);
  const hw = o.hipW || 0.12;
  const thigh = o.thigh || 0.45; const shin = o.shin || 0.45;
  const legL = joint('legL', hw, -0.02, 0); hips.add(legL);
  const legR = joint('legR', -hw, -0.02, 0); hips.add(legR);
  const shinL = joint('shinL', 0, -thigh, 0); legL.add(shinL);
  const shinR = joint('shinR', 0, -thigh, 0); legR.add(shinR);
  const parts = { root, body, hips, torso, head, armL, armR, foreL, foreR, handL, handR, legL, legR, shinL, shinR };
  o.dress(parts, { ua, fa, thigh, shin, sh, hw });
  root.userData.rig = 'humanoid';
  root.userData.parts = parts;
  root.userData.height = (hipY + (o.neckY || 0.62) + 0.3) * s;
  return root;
}

// Limb helper: a tapered segment hanging down from a joint.
const limb = (j, len, r1, r2, mat, seg = 7) => { const m = M(G.cyl(r1, r2, len, seg), mat, 0, -len / 2, 0); j.add(m); return m; };

export function buildKnight(look = {}) {
  const chestT = look.chest?.tier ?? 0;
  const headT = look.head ? look.head.tier : -1;
  const handT = look.hands?.tier ?? -1; const feetT = look.feet?.tier ?? -1;
  return humanoid({
    dress(p, d) {
      const plate = armorMat(chestT); const trim = trimMat(chestT);
      const cloth = common('cloth', { color: 0xb02830 });
      const skin = flat(0xd8a888, { rough: 0.7 });
      const mail = common('iron', { metal: 0.6, rough: 0.55, color: 0x9a9ca0 });
      const legM = chestT >= 1 ? common('iron', { metal: 0.6, rough: 0.5, color: 0x7a7c80 }) : common('leather', { color: 0x8a6a4a });
      // torso: chest plate + tabard + belt
      A(p.torso, M(G.cyl(0.25, 0.2, 0.42, 9), plate, 0, 0.38, 0)).scale.z = 0.72;
      A(p.torso, M(G.cyl(0.2, 0.22, 0.22, 9), mail, 0, 0.1, 0)).scale.z = 0.75;
      const tab = M(G.box(0.3, 0.62, 0.04), cloth, 0, 0.12, 0.155); p.torso.add(tab);
      const tabB = M(G.box(0.3, 0.62, 0.04), cloth, 0, 0.12, -0.15); p.torso.add(tabB);
      A(p.torso, M(G.cyl(0.215, 0.215, 0.07, 9), common('leather', { color: 0x4a2a18 }), 0, 0.0, 0)).scale.z = 0.78;
      p.torso.add(M(G.box(0.08, 0.07, 0.03), trim, 0, 0.0, 0.17));
      // pauldrons
      for (const [arm, sx] of [[p.armL, 1], [p.armR, -1]]) {
        const pd = M(G.sph(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), plate, sx * 0.02, 0.02, 0); pd.scale.set(1.1, 0.9, 1.1); arm.add(pd);
        if (chestT >= 3) arm.add(M(G.box(0.2, 0.03, 0.22), trim, sx * 0.03, 0.08, 0));
      }
      // arms
      limb(p.armL, d.ua, 0.065, 0.06, mail); limb(p.armR, d.ua, 0.065, 0.06, mail);
      limb(p.foreL, d.fa, 0.06, 0.055, plate); limb(p.foreR, d.fa, 0.06, 0.055, plate);
      const glove = handT >= 0 ? armorMat(handT) : common('leather', { color: 0x5a3a20 });
      p.handL.add(M(G.box(0.1, 0.11, 0.1), glove, 0, -0.03, 0)); p.handR.add(M(G.box(0.1, 0.11, 0.1), glove, 0, -0.03, 0));
      // legs
      limb(p.legL, d.thigh, 0.085, 0.07, legM); limb(p.legR, d.thigh, 0.085, 0.07, legM);
      const boot = feetT >= 0 ? armorMat(feetT) : common('leather', { color: 0x4a2e18 });
      limb(p.shinL, d.shin, 0.07, 0.062, boot); limb(p.shinR, d.shin, 0.07, 0.062, boot);
      p.shinL.add(M(G.box(0.12, 0.08, 0.22), boot, 0, -d.shin - 0.0, 0.04)); p.shinR.add(M(G.box(0.12, 0.08, 0.22), boot, 0, -d.shin, 0.04));
      if (chestT >= 2) { p.shinL.add(M(G.sph(0.07, 6, 4), plate, 0, 0, 0.04)); p.shinR.add(M(G.sph(0.07, 6, 4), plate, 0, 0, 0.04)); }
      // head
      p.head.add(M(G.cyl(0.06, 0.07, 0.1, 6), skin, 0, 0.02, 0));
      const face = M(G.sph(0.13, 10, 8), skin, 0, 0.17, 0.01); face.scale.set(0.9, 1.05, 0.95); p.head.add(face);
      p.head.add(M(G.box(0.2, 0.06, 0.05), flat(0x3a2414), 0, 0.12, 0.09)); // beard shadow
      if (headT < 0) {
        const hair = M(G.sph(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), flat(0x4a2c18, { rough: 0.9 }), 0, 0.19, -0.01); p.head.add(hair);
      } else {
        const hm = armorMat(headT);
        const dome = M(G.sph(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hm, 0, 0.18, 0); p.head.add(dome);
        if (headT >= 2) { // great helm: face plate with visor slit
          p.head.add(M(G.cyl(0.15, 0.14, 0.2, 10, 1, true), hm, 0, 0.1, 0));
          p.head.add(M(G.box(0.18, 0.025, 0.02), flat(0x050505), 0, 0.17, 0.145));
        } else {
          p.head.add(M(G.box(0.03, 0.14, 0.03), hm, 0, 0.13, 0.145)); // nasal guard
        }
        if (headT >= 3) for (const sx of [-1, 1]) { const w = M(G.cone(0.05, 0.3, 4), trimMat(headT), sx * 0.15, 0.3, -0.02); w.rotation.z = -sx * 0.9; p.head.add(w); }
        if (headT >= 4) p.head.add(M(G.box(0.04, 0.12, 0.3), trimMat(headT), 0, 0.33, -0.02));
      }
      // weapon & shield
      const wpn = weaponMesh(look.weapon?.kind || 'sword', look.weapon?.tier ?? 0, look.weapon?.rarity);
      wpn.rotation.x = Math.PI / 2; wpn.position.set(0, -0.05, 0.02);
      p.handR.add(wpn); p.weapon = wpn;
      if (look.offhand) {
        const shd = shieldMesh(look.offhand.tier ?? 0, look.offhand.rarity);
        shd.position.set(0.08, -0.04, 0.02); shd.rotation.y = Math.PI / 2 + 0.15;
        p.foreL.add(shd); p.shield = shd;
      }
      // cape for higher tiers
      if (chestT >= 2) {
        const cape = M(new THREE.PlaneGeometry(0.46, 0.85, 1, 4), flat(chestT >= 4 ? 0x1a1a22 : 0x7a1018, { rough: 0.95, side: THREE.DoubleSide }), 0, 0.15, -0.2);
        cape.rotation.x = 0.12; p.torso.add(cape); p.cape = cape;
      }
    },
  });
}

export function buildSkeleton({ archer = false, elite = false } = {}) {
  return humanoid({
    shoulderW: 0.24, upperArm: 0.3, foreArm: 0.28,
    dress(p, d) {
      const bone = common('bone', { rough: 0.75, color: elite ? 0xf0e8a0 : 0xe0d4b8 });
      const rust = common('iron', { metal: 0.4, rough: 0.8, color: 0x7a5a40 });
      // spine + ribs
      p.torso.add(M(G.cyl(0.03, 0.03, 0.55, 5), bone, 0, 0.27, -0.05));
      for (let i = 0; i < 4; i++) { const r = M(new THREE.TorusGeometry(0.14 - i * 0.012, 0.018, 4, 10, Math.PI * 1.4), bone, 0, 0.5 - i * 0.08, 0.0); r.rotation.set(Math.PI / 2, 0, Math.PI * 0.8); r.scale.set(1, 0.8, 1); p.torso.add(r); }
      p.hips.add(M(G.box(0.26, 0.1, 0.12), bone, 0, 0.0, 0));
      for (const j of ['armL', 'armR']) { limb(p[j], d.ua, 0.025, 0.022, bone, 5); p[j].add(M(G.sph(0.05, 6, 4), bone)); }
      for (const j of ['foreL', 'foreR']) limb(p[j], d.fa, 0.022, 0.02, bone, 5);
      for (const j of ['legL', 'legR']) limb(p[j], d.thigh, 0.03, 0.025, bone, 5);
      for (const j of ['shinL', 'shinR']) { limb(p[j], d.shin, 0.025, 0.022, bone, 5); p[j].add(M(G.box(0.08, 0.04, 0.16), bone, 0, -d.shin, 0.04)); }
      p.handL.add(M(G.box(0.06, 0.08, 0.04), bone)); p.handR.add(M(G.box(0.06, 0.08, 0.04), bone));
      const skull = M(G.sph(0.13, 10, 8), bone, 0, 0.16, 0); skull.scale.set(0.9, 1, 1.05); p.head.add(skull);
      p.head.add(M(G.box(0.14, 0.07, 0.12), bone, 0, 0.06, 0.03));
      for (const sx of [-0.045, 0.045]) p.head.add(M(G.sph(0.028, 6, 4), glow(elite ? 0xff5020 : 0x60c0ff), sx, 0.17, 0.11));
      if (archer) {
        const bow = weaponMesh('bow'); bow.position.set(0, -0.04, 0.02); p.handL.add(bow); p.weapon = bow;
        A(p.torso, M(G.cyl(0.06, 0.06, 0.45, 6), common('leather'), 0.08, 0.35, -0.14)).rotation.z = 0.4;
      } else {
        const w = weaponMesh('sword', 0); w.rotation.x = Math.PI / 2; w.position.set(0, -0.05, 0.02); w.traverse((o) => { if (o.isMesh) o.material = rust; }); p.handR.add(w); p.weapon = w;
        if (elite) { const sh = shieldMesh(0); sh.position.set(0.06, -0.04, 0); sh.rotation.y = Math.PI / 2; p.foreL.add(sh); }
      }
      if (elite) p.head.add(M(G.cone(0.14, 0.18, 6), rust, 0, 0.3, 0));
    },
  });
}

export function buildGoblin({ elite = false } = {}) {
  return humanoid({
    hipY: 0.62, neckY: 0.42, shoulderW: 0.2, upperArm: 0.24, foreArm: 0.24, thigh: 0.3, shin: 0.3, hipW: 0.1,
    dress(p, d) {
      const skin = flat(elite ? 0x6a8a2a : 0x5a7a30, { rough: 0.75 });
      const rag = common('leather', { color: 0x6a5030 });
      A(p.torso, M(G.sph(0.2, 10, 8), rag, 0, 0.22, -0.02)).scale.set(1, 1.15, 0.85);
      p.torso.rotation.x = 0.35;
      for (const j of ['armL', 'armR']) limb(p[j], d.ua, 0.05, 0.045, skin);
      for (const j of ['foreL', 'foreR']) limb(p[j], d.fa, 0.045, 0.04, skin);
      for (const j of ['legL', 'legR']) limb(p[j], d.thigh, 0.06, 0.05, rag);
      for (const j of ['shinL', 'shinR']) { limb(p[j], d.shin, 0.045, 0.04, skin); p[j].add(M(G.box(0.08, 0.05, 0.16), skin, 0, -d.shin, 0.04)); }
      const h = M(G.sph(0.15, 10, 8), skin, 0, 0.12, 0.03); h.scale.set(1.05, 0.95, 1.1); p.head.add(h);
      A(p.head, M(G.cone(0.04, 0.12, 5), skin, 0, 0.1, 0.18)).rotation.x = Math.PI / 2;
      for (const sx of [-1, 1]) { const e = M(G.cone(0.05, 0.26, 4), skin, sx * 0.17, 0.16, 0); e.rotation.z = -sx * 1.25; p.head.add(e); p.head.add(M(G.sph(0.025, 6, 4), glow(0xffd020), sx * 0.055, 0.15, 0.15)); }
      const w = weaponMesh('dagger'); w.rotation.x = Math.PI / 2; w.position.set(0, -0.04, 0.02); p.handR.add(w); p.weapon = w;
      if (elite) p.head.add(M(G.cyl(0.08, 0.13, 0.08, 6), common('iron'), 0, 0.25, 0));
    },
  });
}

export function buildImp({ elite = false } = {}) {
  return humanoid({
    hipY: 0.66, neckY: 0.44, shoulderW: 0.2, upperArm: 0.24, foreArm: 0.24, thigh: 0.32, shin: 0.32, hipW: 0.1,
    dress(p, d) {
      const skin = flat(elite ? 0xa01818 : 0xc0402a, { rough: 0.6 });
      const dark = flat(0x2a0a08, { rough: 0.7 });
      A(p.torso, M(G.sph(0.18, 10, 8), skin, 0, 0.22, 0)).scale.set(1, 1.2, 0.8);
      for (const j of ['armL', 'armR']) limb(p[j], d.ua, 0.045, 0.04, skin);
      for (const j of ['foreL', 'foreR']) limb(p[j], d.fa, 0.04, 0.035, skin);
      for (const j of ['legL', 'legR']) limb(p[j], d.thigh, 0.055, 0.045, skin);
      for (const j of ['shinL', 'shinR']) { limb(p[j], d.shin, 0.045, 0.03, dark); }
      const h = M(G.sph(0.14, 10, 8), skin, 0, 0.12, 0.02); p.head.add(h);
      for (const sx of [-1, 1]) { const horn = M(G.cone(0.035, 0.2, 5), dark, sx * 0.08, 0.27, -0.02); horn.rotation.z = -sx * 0.4; p.head.add(horn); p.head.add(M(G.sph(0.025, 6, 4), glow(0xffe060), sx * 0.05, 0.14, 0.12)); }
      // wings
      for (const sx of [-1, 1]) {
        const wshape = new THREE.Shape(); wshape.moveTo(0, 0); wshape.lineTo(sx * 0.5, 0.25); wshape.lineTo(sx * 0.42, -0.05); wshape.lineTo(sx * 0.3, -0.2); wshape.lineTo(0, -0.08);
        const wing = M(new THREE.ShapeGeometry(wshape), flat(0x5a1410, { side: THREE.DoubleSide, rough: 0.8 }), sx * 0.05, 0.35, -0.14);
        wing.rotation.y = -sx * 0.5; p.torso.add(wing); p[sx < 0 ? 'wingR' : 'wingL'] = wing;
      }
      const tail = M(G.cyl(0.02, 0.01, 0.5, 4), skin, 0, -0.05, -0.25); tail.rotation.x = -1.0; p.hips.add(tail);
      const orb = M(G.sph(0.07, 8, 6), glow(0xff8020), 0, -0.06, 0.04); p.handR.add(orb); p.weapon = orb;
    },
  });
}

export function buildOgre() {
  return humanoid({
    scale: 2.1, hipY: 0.82, neckY: 0.66, shoulderW: 0.36, upperArm: 0.36, foreArm: 0.34, thigh: 0.38, shin: 0.38, hipW: 0.16,
    dress(p, d) {
      const skin = flat(0x8a9a6a, { rough: 0.8 });
      const hide = common('leather', { color: 0x7a5434 });
      const belly = M(G.sph(0.36, 12, 10), skin, 0, 0.28, 0.05); belly.scale.set(1, 1.05, 0.9); p.torso.add(belly);
      p.torso.add(M(G.cyl(0.33, 0.34, 0.16, 10), hide, 0, 0.0, 0.02));
      A(p.torso, M(G.sph(0.25, 10, 8), skin, 0, 0.52, -0.05)).scale.set(1.4, 0.8, 1);
      for (const j of ['armL', 'armR']) { limb(p[j], d.ua, 0.11, 0.1, skin); p[j].add(M(G.sph(0.14, 8, 6), hide, 0, 0, 0)); }
      for (const j of ['foreL', 'foreR']) limb(p[j], d.fa, 0.1, 0.09, skin);
      p.handL.add(M(G.sph(0.11, 8, 6), skin)); p.handR.add(M(G.sph(0.11, 8, 6), skin));
      for (const j of ['legL', 'legR']) limb(p[j], d.thigh, 0.13, 0.11, hide);
      for (const j of ['shinL', 'shinR']) { limb(p[j], d.shin, 0.1, 0.09, skin); p[j].add(M(G.box(0.2, 0.08, 0.28), skin, 0, -d.shin, 0.05)); }
      const h = M(G.sph(0.16, 10, 8), skin, 0, 0.1, 0.06); h.scale.set(1.1, 0.95, 1); p.head.add(h);
      p.head.add(M(G.box(0.22, 0.08, 0.12), skin, 0, 0.0, 0.12));
      for (const sx of [-1, 1]) { const t = M(G.cone(0.025, 0.08, 4), common('bone'), sx * 0.07, 0.07, 0.18); t.rotation.x = Math.PI; p.head.add(t); p.head.add(M(G.sph(0.025, 6, 4), glow(0xff3010), sx * 0.06, 0.14, 0.18)); }
      const club = weaponMesh('club'); club.rotation.x = Math.PI / 2; club.position.set(0, -0.05, 0.02); club.scale.setScalar(1.2); p.handR.add(club); p.weapon = club;
    },
  });
}

export function buildMerchant(kind = 'merchant') {
  return humanoid({
    dress(p, d) {
      const robe = common('cloth', { color: kind === 'smith' ? 0x4a3a2a : kind === 'crafter' ? 0x5a2a7a : kind === 'auctioneer' ? 0x2a5a3a : 0x2a4a7a });
      const skin = flat(0xd8a888, { rough: 0.7 });
      p.torso.add(M(G.cyl(0.22, 0.3, 0.75, 9), robe, 0, 0.25, 0));
      p.hips.add(M(G.cyl(0.3, 0.36, 0.9, 9), robe, 0, -0.42, 0));
      for (const j of ['armL', 'armR']) limb(p[j], d.ua, 0.07, 0.065, robe);
      for (const j of ['foreL', 'foreR']) limb(p[j], d.fa, 0.065, 0.06, robe);
      p.handL.add(M(G.sph(0.05, 6, 4), skin)); p.handR.add(M(G.sph(0.05, 6, 4), skin));
      const h = M(G.sph(0.13, 10, 8), skin, 0, 0.17, 0); p.head.add(h);
      A(p.head, M(G.sph(0.11, 8, 6), flat(0xcfcfcf), 0, 0.09, 0.06)).scale.set(1, 1, 0.6);
      if (kind === 'smith') {
        p.torso.add(M(G.box(0.36, 0.6, 0.04), common('leather', { color: 0x3a2414 }), 0, 0.15, 0.22));
        const hm = weaponMesh('hammer'); hm.rotation.x = Math.PI / 2; hm.position.set(0, -0.04, 0.02); p.handR.add(hm);
      } else if (kind === 'crafter') {
        // goggles and a glowing focus crystal
        for (const sx of [-0.05, 0.05]) p.head.add(M(G.cyl(0.035, 0.035, 0.03, 8), glow(0x8affff, 0.9), sx, 0.18, 0.11).rotateX(Math.PI / 2));
        p.head.add(M(G.box(0.2, 0.025, 0.02), common('leather'), 0, 0.18, 0.1));
        const orb = M(G.sph(0.07, 8, 6), glow(0xc080ff), 0, -0.06, 0.03); p.handR.add(orb);
        p.head.add(M(G.sph(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), common('cloth', { color: 0x3a1a4a }), 0, 0.2, -0.01));
      } else if (kind === 'auctioneer') {
        // gold-trimmed coat, a feathered cap and a coin purse
        const gold = common('gold', { color: 0xd8b04a });
        p.torso.add(M(G.box(0.05, 0.62, 0.04), gold, 0, 0.2, 0.24));
        p.head.add(M(G.cyl(0.15, 0.17, 0.12, 10), common('cloth', { color: 0x1a2a1a }), 0, 0.3, 0));
        const fe = M(G.cone(0.03, 0.32, 5), flat(0xc83a3a), 0.12, 0.42, -0.04); fe.rotation.z = -0.5; p.head.add(fe);
        p.hips.add(M(G.sph(0.08, 8, 6), common('leather', { color: 0x6a4a1a }), 0.3, -0.1, 0.1));
        p.handR.add(M(G.cyl(0.04, 0.04, 0.012, 10), gold, 0, -0.05, 0.03));
      } else {
        const hat = M(G.cone(0.2, 0.35, 8), robe, 0, 0.42, 0); p.head.add(hat);
        p.head.add(M(G.cyl(0.26, 0.26, 0.03, 10), robe, 0, 0.27, 0));
      }
      for (const j of ['legL', 'legR', 'shinL', 'shinR']) p[j].visible = false;
    },
  });
}

// ---------------------------------------------------------------- creatures
function quadruped(o) {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body); body.scale.setScalar(o.scale || 1);
  const hips = joint('hips', 0, o.h, 0); body.add(hips);
  const torso = joint('torso', 0, 0, 0); hips.add(torso);
  const head = joint('head', 0, 0.02, o.len / 2); torso.add(head);
  const legs = [];
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const l = joint('leg', x * o.w, -0.02, z * o.len * 0.36); torso.add(l);
    legs.push(l);
  }
  const tail = joint('tail', 0, 0.02, -o.len / 2); torso.add(tail);
  const parts = { root, body, hips, torso, head, legs, tail };
  o.dress(parts);
  root.userData.rig = 'quad'; root.userData.parts = parts; root.userData.height = (o.h + 0.2) * (o.scale || 1);
  return root;
}

export function buildRat({ elite = false } = {}) {
  return quadruped({
    h: 0.24, len: 0.6, w: 0.11, scale: elite ? 1.4 : 1,
    dress(p) {
      const fur = flat(elite ? 0x5a4a3a : 0x6a5a4a, { rough: 0.95 });
      const pink = flat(0xc89090, { rough: 0.7 });
      const b = M(G.sph(0.2, 10, 8), fur, 0, 0.02, 0); b.scale.set(0.9, 0.8, 1.6); p.torso.add(b);
      const h = M(G.cone(0.11, 0.3, 8), fur, 0, 0, 0.1); h.rotation.x = Math.PI / 2; p.head.add(h);
      p.head.add(M(G.sph(0.025, 6, 4), pink, 0, 0, 0.26));
      for (const sx of [-1, 1]) { p.head.add(M(G.sph(0.05, 6, 4), pink, sx * 0.07, 0.08, 0.0)); p.head.add(M(G.sph(0.018, 4, 3), glow(0xff2020), sx * 0.05, 0.04, 0.12)); }
      for (const l of p.legs) limb(l, 0.2, 0.025, 0.02, pink, 5);
      const t = M(G.cyl(0.02, 0.006, 0.55, 4), pink, 0, 0, -0.27); t.rotation.x = Math.PI / 2 + 0.2; p.tail.add(t);
    },
  });
}

function spiderRig(o) {
  const root = new THREE.Group(); const body = new THREE.Group(); root.add(body); body.scale.setScalar(o.scale || 1);
  const hips = joint('hips', 0, 0.32, 0); body.add(hips);
  const torso = joint('torso', 0, 0, 0); hips.add(torso);
  const head = joint('head', 0, 0, 0.22); torso.add(head);
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 1 : -1; const k = i % 4;
    const l = joint('leg', side * 0.14, 0, 0.14 - k * 0.1);
    l.rotation.y = side * (Math.PI / 2) + (k - 1.5) * 0.45 * side;
    torso.add(l);
    const upper = joint('legUpper'); l.add(upper);
    const knee = joint('knee', 0, 0, 0.36); upper.add(knee);
    upper.rotation.x = -0.75;
    knee.rotation.x = 1.75;
    o.dressLeg(upper, knee);
    legs.push({ base: l, upper, knee, phase: (k % 2 === 0 ? 0 : Math.PI) + (side > 0 ? 0 : Math.PI) });
  }
  const abdomen = joint('abdomen', 0, 0.06, -0.18); torso.add(abdomen);
  const parts = { root, body, hips, torso, head, legs, abdomen };
  o.dress(parts);
  root.userData.rig = 'spider'; root.userData.parts = parts; root.userData.height = 0.7 * (o.scale || 1);
  return root;
}

export function buildSpider({ elite = false, scale = 1, brood = false } = {}) {
  const chitin = flat(brood ? 0x2a1a2a : elite ? 0x4a2a10 : 0x2a2420, { rough: 0.45, metal: 0.1 });
  const hairy = flat(brood ? 0x3a2030 : 0x3a3026, { rough: 0.9 });
  return spiderRig({
    scale,
    dressLeg(upper, knee) {
      upper.add(M(G.cyl(0.025, 0.02, 0.36, 5), hairy, 0, 0, 0.18).rotateX(Math.PI / 2));
      knee.add(M(G.cyl(0.02, 0.008, 0.45, 5), chitin, 0, 0, 0.22).rotateX(Math.PI / 2));
    },
    dress(p) {
      A(p.torso, M(G.sph(0.16, 10, 8), chitin)).scale.set(1, 0.7, 1.1);
      const h = M(G.sph(0.1, 8, 6), chitin, 0, 0.02, 0.05); p.head.add(h);
      for (let i = 0; i < 4; i++) p.head.add(M(G.sph(0.018, 4, 3), glow(brood ? 0x40ff60 : 0xff3020), (i - 1.5) * 0.035, 0.06 + (i % 2) * 0.02, 0.13));
      for (const sx of [-1, 1]) { const f = M(G.cone(0.02, 0.12, 4), flat(0x0a0a0a), sx * 0.04, -0.04, 0.14); f.rotation.x = Math.PI * 0.8; p.head.add(f); }
      const ab = M(G.sph(0.26, 12, 10), hairy, 0, 0.05, -0.18); ab.scale.set(1, 0.85, 1.25); p.abdomen.add(ab);
      p.abdomen.add(M(G.box(0.1, 0.01, 0.25), glow(brood ? 0x40ff60 : 0xb03020, 0.8), 0, 0.27, -0.2));
      if (brood) for (let i = 0; i < 6; i++) { const s = M(G.cone(0.035, 0.2, 4), chitin, Math.cos(i) * 0.15, 0.25, -0.1 - i * 0.05); p.abdomen.add(s); }
    },
  });
}

// ---------------------------------------------------------------- factory
const glbCache = new Map();
const loader = new GLTFLoader();
let manifest = null;

// Optional Blender-made models listed in /models/manifest.json replace the built-in ones.
export async function loadModelManifest() {
  try {
    const r = await fetch('/models/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    manifest = await r.json();
    await Promise.all(Object.entries(manifest.models || {}).map(async ([key, file]) => {
      try { const g = await loader.loadAsync(`/models/${file}`); glbCache.set(key, g.scene); } catch (e) { console.warn('model', key, e); }
    }));
  } catch { /* no manifest: use built-in models */ }
}

// Swap Blender's plain materials (by name) for the game's textured ones, keeping their colors.
function texturize(root, { tier = null } = {}) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const src = o.material; const nm = (src.name || '').replace(/\.\d+$/, '');
    const col = src.color ? src.color.getHex() : 0xffffff;
    let m = null;
    if (nm === 'armor') m = tier === 0 ? common('leather', { rough: 0.8, color: 0xffd8b0 }) : common('steel', { metal: 0.75, rough: 0.38, color: tier == null ? col : TIER_METAL[tier] });
    else if (nm === 'trim') m = tier == null ? common('gold', { metal: 0.85, rough: 0.3, color: col }) : trimMat(Math.max(1, tier));
    else if (nm === 'iron' || nm === 'rustiron') m = common('iron', { metal: src.metalness ?? 0.6, rough: src.roughness ?? 0.5, color: col });
    else if (nm === 'leather') m = common('leather', { rough: 0.85, color: col });
    else if (nm === 'cloth' || nm === 'capemat') m = common('clothN', { rough: 0.9, color: col });
    else if (nm === 'bone') m = common('bone', { rough: 0.75, color: col });
    else if (nm === 'wood') m = common('wood', { rough: 0.85, color: col });
    if (m) o.material = m;
    o.castShadow = true;
  });
}

function fromGlb(key, look = null) {
  const src = glbCache.get(key);
  if (!src) return null;
  const root = new THREE.Group();
  const body = src.clone(true);
  root.add(body);
  const parts = { root, body };
  body.traverse((o) => { if (o.name && !parts[o.name]) parts[o.name] = o; });
  root.userData.rig = manifest.rigs?.[key] || 'humanoid';
  if (root.userData.rig === 'spider') {
    parts.legs = [];
    for (let i = 0; i < 8; i++) { const upper = parts[`legUpper${i}`]; const knee = parts[`knee${i}`]; if (upper && knee) parts.legs.push({ upper, knee, phase: (i % 2 ? Math.PI : 0) + (i < 4 ? 0 : Math.PI) }); }
  }
  if (root.userData.rig === 'quad') parts.legs = [0, 1, 2, 3].map((i) => parts[`leg${i}`]).filter(Boolean);
  root.userData.parts = parts;
  root.userData.height = manifest.heights?.[key] || 1.8;
  root.userData.fromGlb = true;
  if (look) {
    // Hero: gear tiers decide which helm shows, armor color and the cape.
    const chestT = look.chest?.tier ?? 0; const headT = look.head ? look.head.tier : -1;
    texturize(body, { tier: chestT });
    for (let t = 0; t < 6; t++) if (parts[`helm_t${t}`]) parts[`helm_t${t}`].visible = t === headT;
    if (parts.hair) parts.hair.visible = headT < 0;
    if (parts.cape) {
      parts.cape.visible = chestT >= 2;
      parts.cape.material = flat(chestT >= 4 ? 0x1a1a22 : 0x7a1018, { rough: 0.95, side: THREE.DoubleSide });
      parts.cape.userData.baseX = parts.cape.rotation.x;
    }
    const wpn = weaponMesh(look.weapon?.kind || 'sword', look.weapon?.tier ?? 0, look.weapon?.rarity);
    wpn.rotation.x = Math.PI / 2; wpn.position.set(0, -0.05, 0.02);
    parts.handR.add(wpn); parts.weapon = wpn;
    if (look.offhand) {
      const shd = shieldMesh(look.offhand.tier ?? 0, look.offhand.rarity);
      shd.position.set(0.09, -0.04, 0.02); shd.rotation.y = Math.PI / 2 + 0.15;
      parts.foreL.add(shd); parts.shield = shd;
    }
  } else texturize(body);
  return root;
}

export function buildMonster(type, { elite = false } = {}) {
  let fromFile = fromGlb(elite ? `${type}_elite` : type) || fromGlb(type);
  if (!fromFile && type === 'archer') {
    // Archers reuse the skeleton model with a bow instead of a sword.
    fromFile = fromGlb('skeleton');
    if (fromFile) {
      const p = fromFile.userData.parts;
      if (p.weapon) p.weapon.visible = false;
      const bow = weaponMesh('bow'); bow.position.set(0, -0.04, 0.02); p.handL.add(bow); p.weapon = bow;
    }
  }
  if (fromFile) { if (elite) fromFile.scale.setScalar(1.25); return fromFile; }
  let m;
  switch (type) {
    case 'skeleton': m = buildSkeleton({ elite }); break;
    case 'archer': m = buildSkeleton({ archer: true, elite }); break;
    case 'goblin': m = buildGoblin({ elite }); break;
    case 'imp': m = buildImp({ elite }); break;
    case 'rat': m = buildRat({ elite }); break;
    case 'spider': m = buildSpider({ elite, scale: elite ? 1.5 : 1.15 }); break;
    case 'spiderling': m = buildSpider({ scale: 0.6 }); break;
    case 'broodmother': m = buildSpider({ scale: 3.4, brood: true }); break;
    case 'ogre': m = buildOgre(); break;
    default: m = buildSkeleton({});
  }
  if (elite && type !== 'spider' && type !== 'rat') m.scale.setScalar(1.25);
  return m;
}

export function buildHero(cls, look) {
  return fromGlb(`hero_${cls}`, look || {}) || fromGlb('hero_knight', look || {}) || buildKnight(look);
}

// Druid's summon: a translucent glowing wolf.
export function buildWolf() {
  return quadruped({
    h: 0.5, len: 1.0, w: 0.17,
    dress(p) {
      const fur = new THREE.MeshStandardMaterial({ color: 0x9ad8ff, emissive: 0x2a6a9a, emissiveIntensity: 0.8, roughness: 0.6, transparent: true, opacity: 0.85 });
      const b = M(G.sph(0.3, 12, 8), fur, 0, 0.05, 0); b.scale.set(0.85, 0.85, 1.6); p.torso.add(b);
      const chest = M(G.sph(0.26, 10, 8), fur, 0, 0.08, 0.3); p.torso.add(chest);
      const h = M(G.sph(0.17, 10, 8), fur, 0, 0.08, 0.05); h.scale.set(0.9, 0.85, 1.1); p.head.add(h);
      const snout = M(G.cone(0.1, 0.26, 7), fur, 0, 0.03, 0.24); snout.rotation.x = Math.PI / 2; p.head.add(snout);
      for (const sx of [-1, 1]) {
        const ear = M(G.cone(0.05, 0.14, 4), fur, sx * 0.08, 0.22, 0.0); p.head.add(ear);
        p.head.add(M(G.sph(0.025, 6, 4), glow(0xe0f8ff), sx * 0.07, 0.12, 0.16));
      }
      for (const l of p.legs) limb(l, 0.44, 0.055, 0.04, fur, 6);
      const t = M(G.cone(0.08, 0.5, 6), fur, 0, 0.05, -0.25); t.rotation.x = -Math.PI / 2 - 0.5; p.tail.add(t);
    },
  });
}

export function blobShadow(r = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.6, r * 2.6), blobShadowMaterial());
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------- animation
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Drives a rig each frame from simple state: movement speed, the current action, stun, death.
 */
export class Animator {
  constructor(model, opts = {}) {
    this.m = model; this.p = model.userData.parts; this.rig = model.userData.rig;
    this.phase = Math.random() * 10; this.t = Math.random() * 10;
    this.action = null; this.combo = 0;
    this.speed = 0; this.dead = false; this.deadT = 0; this.windup = false; this.stunned = false;
    this.flash = 0; this.flinch = 0;
    this.stride = opts.stride || 1.6;
    this.mats = [];
    // Remember each joint's rest rotation so models can be posed (e.g. a hunched goblin).
    this.base = {};
    for (const k of ['torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR']) {
      const j = this.p[k];
      if (j?.rotation) this.base[k] = { x: j.rotation.x, y: j.rotation.y, z: j.rotation.z };
    }
    model.traverse((o) => { if (o.isMesh && o.material && 'emissive' in o.material) { o.material = o.material.clone(); this.mats.push(o.material); } });
  }

  play(name, dur) {
    const DUR = { swing: 0.34, cleave: 0.5, bash: 0.36, charge: 0.32, warcry: 0.7, attack: 0.45, shoot: 0.5, slam: 1.3, cast: 0.5, hit: 0.2, frenzy: 0.4, leap: 0.42, whirlwind: 0.8, throw: 0.3 };
    if (name === 'swing') this.combo = (this.combo + 1) % 3;
    this.action = { name, t: 0, dur: dur || DUR[name] || 0.4, combo: this.combo };
  }

  hit() { this.flash = 0.12; this.flinch = 0.18; }
  die() { if (!this.dead) { this.dead = true; this.deadT = 0; this.action = null; } }
  revive() { this.dead = false; this.deadT = 0; this.m.rotation.x = 0; this.m.position.y = 0; this.p.body.rotation.set(0, 0, 0); this.p.body.position.set(0, 0, 0); }

  update(dt) {
    this.t += dt;
    const a = this.action;
    if (a) { a.t += dt; if (a.t >= a.dur) this.action = null; }
    if (this.flash > 0) {
      this.flash -= dt;
      const v = Math.max(0, this.flash) * 4;
      for (const m of this.mats) m.emissive.setRGB(v, v * 0.35, v * 0.3);
    }
    this.flinch = Math.max(0, this.flinch - dt);
    if (this.rig === 'humanoid') this.humanoid(dt);
    else if (this.rig === 'quad') this.quad(dt);
    else if (this.rig === 'spider') this.spider(dt);
  }

  deathPose(dt) {
    this.deadT += dt;
    const k = Math.min(1, this.deadT / 0.55);
    const b = this.p.body;
    b.rotation.x = -ease(k) * Math.PI / 2 * 0.95;
    b.position.y = Math.sin(k * Math.PI) * 0.15;
    if (this.deadT > 4) b.position.y = -(this.deadT - 4) * 0.4; // sink away
  }

  humanoid(dt) {
    const p = this.p;
    if (this.dead) { this.deathPose(dt); return; }
    const run = Math.min(1, this.speed / 4.5);
    this.phase += dt * this.speed * (Math.PI * 2) / this.stride;
    const s = Math.sin(this.phase); const c = Math.cos(this.phase);
    const breathe = Math.sin(this.t * 2.2) * 0.02;
    // base locomotion pose
    let legL = s * 0.75 * run; let legR = -s * 0.75 * run;
    let shinL = Math.max(0, -c) * 1.1 * run + 0.05; let shinR = Math.max(0, c) * 1.1 * run + 0.05;
    let armLx = -s * 0.55 * run + 0.1; let armRx = s * 0.55 * run - 0.25;
    let armLz = 0.12; let armRz = -0.12;
    let foreL = -0.35 - run * 0.4; let foreR = -0.55 - run * 0.3;
    let torsoX = 0.08 * run + breathe; let torsoY = 0; let torsoZ = 0;
    let headX = -0.05 * run; let headY = 0;
    let hipsY = Math.abs(c) * 0.05 * run; let bodyRotY = 0; let bodyZ = 0;
    if (p.shield) { armLx = 0.15 + -s * 0.2 * run; foreL = -1.25; armLz = 0.3; }
    if (this.windup) { armRx = -2.4; foreR = -0.6; torsoY = 0.35; torsoX = -0.1; }
    if (this.stunned) { headX = 0.3 + Math.sin(this.t * 9) * 0.15; headY = Math.sin(this.t * 7) * 0.3; armRx = 0.2; armLx = 0.2; }

    const a = this.action;
    if (a) {
      const k = a.t / a.dur;
      switch (a.name) {
        case 'swing': case 'attack': {
          // wind up quickly, strike, recover. Alternate directions for a 3-hit combo feel.
          const dir = a.combo === 1 ? -1 : 1;
          const up = k < 0.3 ? ease(k / 0.3) : 1 - ease(Math.min(1, (k - 0.3) / 0.35));
          const strike = k < 0.3 ? 0 : ease(Math.min(1, (k - 0.3) / 0.25));
          if (a.combo === 2) { // overhead chop
            armRx = lerp(-0.2, -2.9, up) + strike * 1.6; foreR = -0.2 - up * 0.6; torsoX = -0.15 * up + strike * 0.3;
          } else {
            armRx = lerp(-0.4, -1.7, up) - 0.2 * strike; armRz = -0.1 - dir * (lerp(0.9, -1.0, strike) * (1 - up * 0.2));
            foreR = -0.5 + strike * 0.4; torsoY = dir * lerp(0.6, -0.7, strike) * (up > 0.2 ? 1 : up * 5);
          }
          bodyZ = strike * 0.12 * (1 - k);
          break;
        }
        case 'cleave': {
          const spin = ease(Math.min(1, k / 0.8));
          bodyRotY = -spin * Math.PI * 2;
          armRx = -1.6; armRz = -1.3; foreR = -0.1; torsoX = 0.25;
          legL = 0.4; legR = -0.4; shinL = 0.4; shinR = 0.4; hipsY = -0.12;
          break;
        }
        case 'bash': {
          const th = k < 0.35 ? ease(k / 0.35) : 1 - ease((k - 0.35) / 0.65);
          armLx = lerp(armLx, -1.4, th); foreL = lerp(foreL, -0.3, th); armLz = lerp(armLz, -0.2, th);
          torsoY = -0.6 * th; torsoX = 0.25 * th; bodyZ = th * 0.4;
          legL = -0.5 * th; legR = 0.5 * th;
          break;
        }
        case 'charge': {
          torsoX = 0.6; armLx = -1.2; foreL = -0.4; armRx = 0.6; legL = s * 1.2; legR = -s * 1.2; shinL = 0.9; shinR = 0.9;
          this.phase += dt * 30;
          break;
        }
        case 'warcry': {
          const up = k < 0.25 ? ease(k / 0.25) : k > 0.8 ? 1 - ease((k - 0.8) / 0.2) : 1;
          armRx = -2.8 * up; armRz = -0.4 * up; armLx = -2.6 * up; armLz = 0.5 * up; foreR = -0.2; foreL = -0.2;
          headX = -0.5 * up; torsoX = -0.25 * up;
          break;
        }
        case 'shoot': {
          const draw = k < 0.6 ? ease(k / 0.6) : 1;
          armLx = -1.5; armLz = 0.1; foreL = 0; armRx = -1.5; armRz = 0.6 * draw; foreR = -1.6 * draw; torsoY = 0.5;
          break;
        }
        case 'frenzy': {
          // two quick slashes: right-to-left then back
          const h = k < 0.5 ? k / 0.5 : (k - 0.5) / 0.5; const dir = k < 0.5 ? 1 : -1;
          const up = h < 0.35 ? ease(h / 0.35) : 1 - ease(Math.min(1, (h - 0.35) / 0.5));
          armRx = -1.5 - up * 0.3; armRz = -dir * lerp(1.0, -1.0, ease(Math.min(1, h * 1.4))); foreR = -0.4;
          torsoY = dir * lerp(0.6, -0.6, ease(Math.min(1, h * 1.4))); torsoX = 0.2;
          legL = 0.3; legR = -0.3;
          break;
        }
        case 'leap': {
          const up = Math.sin(Math.min(1, k / 0.85) * Math.PI);
          hipsY = up * 0.9;
          armRx = k < 0.7 ? -2.9 : lerp(-2.9, 0.6, ease((k - 0.7) / 0.3)); armLx = k < 0.7 ? -2.5 : -0.4; foreR = -0.3;
          legL = -0.9 * up; legR = 0.3 * up; shinL = 1.4 * up; shinR = 1.2 * up;
          torsoX = k > 0.7 ? 0.5 : -0.2;
          break;
        }
        case 'whirlwind': {
          bodyRotY = -ease(k) * Math.PI * 4;
          armRx = -1.6; armRz = -1.4; foreR = 0; armLx = -1.4; armLz = 1.2; foreL = -0.2; torsoX = 0.15;
          legL = 0.3; legR = -0.3; shinL = 0.3; shinR = 0.3; hipsY = -0.08;
          break;
        }
        case 'throw': {
          const up = k < 0.35 ? ease(k / 0.35) : 1 - ease((k - 0.35) / 0.65);
          armRx = lerp(-0.3, -2.6, up) + (k > 0.35 ? (1 - up) * 1.4 : 0); foreR = -0.3 - up * 0.5; torsoY = 0.4 * up - (k > 0.35 ? 0.3 * (1 - up) : 0);
          armLx = -0.6; foreL = -0.8;
          break;
        }
        case 'cast': {
          const up = Math.sin(k * Math.PI);
          armRx = -1.8 * up; foreR = -0.4; armLx = -1.6 * up; foreL = -0.4; torsoX = -0.1 * up;
          break;
        }
        case 'slam': {
          const raise = k < 0.7 ? ease(k / 0.7) : 1 - ease((k - 0.7) / 0.3) * 1.3;
          armRx = -3.0 * raise + (k > 0.7 ? 0.8 : 0); armLx = -2.6 * raise; foreR = -0.3; foreL = -0.3;
          torsoX = -0.3 * raise + (k > 0.7 ? 0.5 : 0); hipsY = k > 0.7 ? -0.12 : 0;
          break;
        }
        default: break;
      }
    }
    if (this.flinch > 0) { torsoX -= this.flinch * 1.5; headX -= this.flinch; }

    const B = this.base; const z0 = { x: 0, y: 0, z: 0 };
    const set = (k, x, y, z) => { const b = B[k] || z0; p[k].rotation.set(b.x + x, b.y + y, b.z + z); };
    set('legL', legL, 0, 0); set('legR', legR, 0, 0);
    set('shinL', shinL, 0, 0); set('shinR', shinR, 0, 0);
    set('armL', armLx, 0, armLz); set('armR', armRx, 0, armRz);
    set('foreL', foreL, 0, 0); set('foreR', foreR, 0, 0);
    set('torso', torsoX, torsoY, torsoZ);
    set('head', headX, headY, 0);
    p.hips.position.y = (p.hips.userData.baseY ??= p.hips.position.y) + hipsY;
    p.body.rotation.y = bodyRotY;
    p.body.position.z = bodyZ;
    if (p.cape) p.cape.rotation.x = (p.cape.userData.baseX ?? 0.12) + run * 0.5 + Math.sin(this.t * 3) * 0.04;
    if (p.wingL) { const f = Math.sin(this.t * 14) * 0.5; p.wingL.rotation.y = 0.5 + f; p.wingR.rotation.y = -0.5 - f; }
  }

  quad(dt) {
    const p = this.p;
    if (this.dead) { this.deadT += dt; const k = Math.min(1, this.deadT / 0.4); p.body.rotation.z = ease(k) * Math.PI * 0.95; p.body.position.y = Math.sin(k * Math.PI) * 0.2; if (this.deadT > 4) p.body.position.y = -(this.deadT - 4) * 0.3; return; }
    this.phase += dt * Math.max(this.speed, 0) * 9;
    const run = Math.min(1, this.speed / 3);
    p.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.7 * run; });
    p.tail.rotation.y = Math.sin(this.t * 6) * 0.4;
    let lunge = 0; let headX = 0;
    const a = this.action;
    if (a && (a.name === 'attack')) { const k = a.t / a.dur; lunge = Math.sin(k * Math.PI) * 0.25; headX = -Math.sin(k * Math.PI) * 0.5; }
    if (this.windup) headX = 0.3;
    p.torso.position.z = lunge; p.head.rotation.x = headX;
    p.hips.position.y = (p.hips.userData.baseY ??= p.hips.position.y) + Math.abs(Math.sin(this.phase)) * 0.03 * run;
  }

  spider(dt) {
    const p = this.p;
    if (this.dead) {
      this.deadT += dt; const k = Math.min(1, this.deadT / 0.5);
      for (const l of p.legs) { l.upper.rotation.x = lerp(-0.75, 0.6, k); l.knee.rotation.x = lerp(1.75, 2.6, k); }
      p.hips.position.y = lerp(p.hips.userData.baseY ?? 0.32, 0.1, k);
      if (this.deadT > 4) p.body.position.y = -(this.deadT - 4) * 0.3;
      return;
    }
    p.hips.userData.baseY ??= p.hips.position.y;
    this.phase += dt * (this.speed * 7 + 1.2);
    const run = Math.min(1, this.speed / 3 + 0.15);
    for (const l of p.legs) {
      const s = Math.sin(this.phase + l.phase);
      l.upper.rotation.x = -0.75 + Math.max(0, s) * -0.5 * run;
      l.upper.rotation.z = Math.cos(this.phase + l.phase) * 0.3 * run;
    }
    let rear = 0; let lunge = 0;
    const a = this.action;
    if (a && (a.name === 'attack' || a.name === 'slam')) { const k = a.t / a.dur; rear = Math.sin(k * Math.PI) * (a.name === 'slam' ? 0.7 : 0.35); lunge = Math.sin(k * Math.PI) * 0.25; }
    if (this.windup) rear = 0.3;
    p.torso.rotation.x = -rear; p.torso.position.z = lunge;
    p.hips.position.y = p.hips.userData.baseY + Math.sin(this.phase * 2) * 0.015;
    if (p.abdomen) p.abdomen.rotation.x = Math.sin(this.t * 2) * 0.05 + rear * 0.5;
  }
}
