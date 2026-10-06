// Turns a GameMap (shared/map.js) into meshes: floors with baked corner shading, walls that
// cut away between the camera and the hero, props, and the light anchors.
import * as THREE from 'three';
import { TILE, T } from '/shared/map.js';
import { texMat } from './materials.js';
import { THEME_TEX } from './textures.js';
import * as P from './props.js';

export const WALL_H = 3.2;

// Cutaway: walls near the line from the hero to the camera drop to knee height.
export const cutUniforms = { uCut: { value: new THREE.Vector4(0, 0, 0, 1) }, uCutOn: { value: 1 } };
function cutaway(mat) {
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCut = cutUniforms.uCut; sh.uniforms.uCutOn = cutUniforms.uCutOn;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCenter;\nuniform vec4 uCut;\nuniform float uCutOn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 rel = aCenter - uCut.xy;
        float along = dot(rel, uCut.zw);
        float perp = abs(rel.x * uCut.w - rel.y * uCut.z);
        float k = smoothstep(-0.6, 1.4, along) * (1.0 - smoothstep(4.5, 7.5, perp)) * (1.0 - smoothstep(16.0, 22.0, along)) * uCutOn;
        if (transformed.y > 0.45) transformed.y = mix(transformed.y, 0.45, k);`);
  };
  m.customProgramCacheKey = () => `cut-${mat.uuid}`;
  return m;
}

export function buildLevel(map, quality) {
  const root = new THREE.Group();
  const anim = []; // things that animate (flames, water, glows)
  const lights = []; // light anchors { x, y, h, color, flame }
  const batch = new P.Batcher();
  const isTown = map.kind === 'town';
  const theme = map.theme;

  if (isTown) buildTownGround(map, root);
  else buildDungeonGeometry(map, root, theme);

  for (const pr of map.props) {
    const { x, y, rot = 0 } = pr;
    switch (pr.type) {
      case 'torch': {
        batch.addObject(P.place(P.torch(theme), x, y, rot));
        const f = P.flame(THEME_TEX[theme]?.torch || 0xffa040, 1);
        f.position.set(x + Math.sin(rot) * 0.42, 2.62, y + Math.cos(rot) * 0.42);
        root.add(f); anim.push(f);
        lights.push({ x: x + Math.sin(rot) * 0.6, y: y + Math.cos(rot) * 0.6, h: 2.5, color: THEME_TEX[theme]?.torch || 0xffa040, flame: f });
        break;
      }
      case 'banner': batch.addObject(P.place(P.banner(theme), x, y, rot)); break;
      case 'bones': batch.addObject(P.place(P.bones(), x, y, rot, pr.s)); break;
      case 'skullpile': batch.addObject(P.place(P.skullpile(), x, y, rot, pr.s)); break;
      case 'rubble': batch.addObject(P.place(P.rubble(theme), x, y, rot, pr.s)); break;
      case 'candles': {
        batch.addObject(P.place(P.candles(), x, y, rot, pr.s));
        const f = P.flame(0xffc070, 0.25); f.position.set(x, 0.42 * (pr.s || 1), y); root.add(f); anim.push(f);
        break;
      }
      case 'mushrooms': batch.addObject(P.place(P.mushrooms(), x, y, rot, pr.s)); break;
      case 'crystal': batch.addObject(P.place(P.crystal(), x, y, rot, pr.s)); lights.push({ x, y, h: 1, color: 0x8a6aff, weak: true }); break;
      case 'brazier': {
        batch.addObject(P.place(P.brazier(), x, y, rot));
        const f = P.flame(0xff7a30, 1.3); f.position.set(x, 1.35, y); root.add(f); anim.push(f);
        lights.push({ x, y, h: 1.8, color: 0xff7a30, flame: f });
        break;
      }
      case 'stairsDown': {
        const s = P.place(P.stairsDown(theme), x, y, rot); root.add(s);
        const gl = P.stairsGlow(0x6aa0ff); gl.position.set(x, 0, y); root.add(gl); anim.push(gl);
        break;
      }
      case 'stairsUp': {
        const s = P.place(P.stairsUp(theme), x, y, rot); root.add(s);
        const gl = P.stairsGlow(0xffd890); gl.position.set(x, 0, y); gl.scale.set(0.8, 1, 0.8); root.add(gl); anim.push(gl);
        break;
      }
      case 'house': batch.addObject(P.place(P.house(rot ? pr.w : pr.w, pr.d, pr.variant), x, y, rot)); break;
      case 'fountain': { const f = P.place(P.fountain(pr.w, pr.d), x, y, rot); root.add(f); anim.push(f); break; }
      case 'tree': batch.addObject(P.place(P.tree(pr.s, Math.round(pr.rot * 7)), x, y, rot)); break;
      case 'lamppost': {
        batch.addObject(P.place(P.lamppost(), x, y, 0));
        lights.push({ x, y, h: 3.3, color: 0xffc070, night: true });
        break;
      }
      case 'dungeonGate': { root.add(P.place(P.dungeonGate(), x, y, rot)); const gl = P.stairsGlow(0xff5020); gl.position.set(x, 0, y + 0.8); gl.scale.set(1.3, 1.2, 0.6); root.add(gl); anim.push(gl); break; }
      default: break;
    }
  }
  for (const l of map.lights) if (!lights.some((q) => Math.hypot(q.x - l.x, q.y - l.y) < 1.2)) lights.push({ ...l, color: l.color || 0xffa040 });

  // Pillars (blocking tiles) in dungeons; trees fill the town border.
  if (!isTown) {
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      if (map.get(tx, ty) === T.PILLAR) batch.addObject(P.place(P.pillar(theme, WALL_H), tx * TILE + 1, ty * TILE + 1, 0));
    }
  } else {
    buildTownBorder(map, batch);
    // NPC stalls
    for (const n of map.npcs) {
      const s = n.type === 'smith' ? P.anvil() : P.stall(0x2a5a8a);
      batch.addObject(P.place(s, n.x + Math.sin(n.rot) * (n.type === 'smith' ? 1.1 : -0.2), n.y + Math.cos(n.rot) * (n.type === 'smith' ? 1.1 : -0.2), n.rot + (n.type === 'smith' ? Math.PI / 2 : Math.PI)));
    }
  }
  batch.build(root);
  root.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  return { root, anim, lights };
}

// ---------------------------------------------------------------- dungeon
function buildDungeonGeometry(map, root, theme) {
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const floorMat = texMat(`${theme}-floor`, t.floor, { rough: 0.92 });
  const wallMat = cutaway(texMat(`${theme}-wall`, t.wall, { rough: 0.95 }));
  const topMat = cutaway(texMat(`${theme}-top`, t.top, { rough: 1 }));
  floorMat.vertexColors = true; floorMat.needsUpdate = true;
  wallMat.vertexColors = true;

  // Floors: one quad per tile, corners darkened by neighbouring walls (cheap baked AO).
  const fp = []; const fn = []; const fu = []; const fc = [];
  const solid = (x, y) => map.get(x, y) !== T.FLOOR && map.get(x, y) !== T.PILLAR ? 1 : 0;
  const ao = (vx, vy) => {
    const n = solid(vx - 1, vy - 1) + solid(vx, vy - 1) + solid(vx - 1, vy) + solid(vx, vy);
    return [1, 0.72, 0.55, 0.45, 0.4][n];
  };
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const v = map.get(tx, ty);
      if (v !== T.FLOOR && v !== T.PILLAR) continue;
      const x0 = tx * TILE; const z0 = ty * TILE; const x1 = x0 + TILE; const z1 = z0 + TILE;
      const c = [[x0, z0, ao(tx, ty)], [x1, z0, ao(tx + 1, ty)], [x1, z1, ao(tx + 1, ty + 1)], [x0, z1, ao(tx, ty + 1)]];
      for (const i of [0, 3, 1, 1, 3, 2]) {
        const [x, z, a] = c[i];
        fp.push(x, 0, z); fn.push(0, 1, 0); fu.push(x / 4, z / 4); fc.push(a, a, a);
      }
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fg.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
  fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  computeTangentsSafe(fg);
  const floor = new THREE.Mesh(fg, floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // Walls: only faces that border walkable space, plus tops. aCenter drives the cutaway.
  const wp = []; const wn = []; const wu = []; const wc = []; const wa = [];
  const tp = []; const tn = []; const tu = []; const ta = [];
  const open = (x, y) => { const v = map.get(x, y); return v === T.FLOOR || v === T.PILLAR; };
  const H = WALL_H;
  const pushQuad = (arrP, arrN, arrU, arrA, arrC, verts, nrm, uvs, center, shade) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      arrP.push(...verts[i]); arrN.push(...nrm); arrU.push(...uvs[i]); arrA.push(...center);
      if (arrC) { const s = verts[i][1] < 0.01 ? shade * 0.6 : shade; arrC.push(s, s, s); }
    }
  };
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.get(tx, ty) !== T.WALL) continue;
      const x0 = tx * TILE; const z0 = ty * TILE; const x1 = x0 + TILE; const z1 = z0 + TILE;
      const cen = [x0 + 1, z0 + 1];
      // jitter the height slightly for a hand-built look
      const h = H + (((tx * 73856093) ^ (ty * 19349663)) % 7) * 0.03;
      if (open(tx, ty + 1)) pushQuad(wp, wn, wu, wa, wc, [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], [[x0 / 2, 0], [x1 / 2, 0], [x1 / 2, h / 2.6], [x0 / 2, h / 2.6]], cen, 1);
      if (open(tx, ty - 1)) pushQuad(wp, wn, wu, wa, wc, [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]], [0, 0, -1], [[x1 / 2, 0], [x0 / 2, 0], [x0 / 2, h / 2.6], [x1 / 2, h / 2.6]], cen, 0.85);
      if (open(tx + 1, ty)) pushQuad(wp, wn, wu, wa, wc, [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], [1, 0, 0], [[z1 / 2, 0], [z0 / 2, 0], [z0 / 2, h / 2.6], [z1 / 2, h / 2.6]], cen, 0.92);
      if (open(tx - 1, ty)) pushQuad(wp, wn, wu, wa, wc, [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], [[z0 / 2, 0], [z1 / 2, 0], [z1 / 2, h / 2.6], [z0 / 2, h / 2.6]], cen, 0.92);
      let nearOpen = false;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (open(tx + ox, ty + oy)) nearOpen = true;
      if (nearOpen) pushQuad(tp, tn, tu, ta, null, [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], [0, 1, 0], [[x0 / 4, z1 / 4], [x1 / 4, z1 / 4], [x1 / 4, z0 / 4], [x0 / 4, z0 / 4]], cen);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  wg.setAttribute('aCenter', new THREE.Float32BufferAttribute(wa, 2));
  computeTangentsSafe(wg);
  root.add(new THREE.Mesh(wg, wallMat));
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  tg.setAttribute('aCenter', new THREE.Float32BufferAttribute(ta, 2));
  root.add(new THREE.Mesh(tg, topMat));

  // A black void plane under everything so gaps never show the clear color oddly.
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(map.w * TILE + 80, map.h * TILE + 80), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  voidPlane.rotation.x = -Math.PI / 2; voidPlane.position.set(map.w, -0.05, map.h);
  root.add(voidPlane);
}

function computeTangentsSafe(geo) { /* normal maps use screen-space derivatives; no tangents needed */ }

// ---------------------------------------------------------------- town
function buildTownGround(map, root) {
  const T2 = THEME_TEX.town;
  const grass = texMat('town-grass', T2.grass, { rough: 1 });
  const cobble = texMat('town-cobble', T2.cobble, { rough: 0.85 });
  const arrays = [{ p: [], u: [] }, { p: [], u: [] }];
  for (let ty = -6; ty < map.h + 6; ty++) {
    for (let tx = -6; tx < map.w + 6; tx++) {
      const inside = tx >= 0 && ty >= 0 && tx < map.w && ty < map.h;
      const g = inside ? map.ground[ty * map.w + tx] : 0;
      const a = arrays[g];
      const x0 = tx * TILE; const z0 = ty * TILE; const x1 = x0 + TILE; const z1 = z0 + TILE;
      const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      for (const i of [0, 3, 1, 1, 3, 2]) { a.p.push(c[i][0], 0, c[i][1]); a.u.push(c[i][0] / 5, c[i][1] / 5); }
    }
  }
  [grass, cobble].forEach((mat, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arrays[i].p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(arrays[i].p.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(arrays[i].u, 2));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.position.y = i * 0.01;
    root.add(m);
  });
  // big outer field fading into fog
  const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2a4a1e, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.set(map.w, -0.03, map.h);
  root.add(far);
}

function buildTownBorder(map, batch) {
  // Palisade along the town edge plus a ring of forest outside it.
  const W = map.w * TILE; const H = map.h * TILE;
  const seg = (x, y, len, rot) => batch.addObject(P.place(P.palisade(len), x, y, rot));
  seg(W / 2, 1, W - 2, 0); seg(W / 2, H - 1, W - 2, 0);
  seg(1, H / 2, H - 2, Math.PI / 2); seg(W - 1, H / 2, H - 2, Math.PI / 2);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const side = i % 4; const t = rnd();
    const out = 2 + rnd() * 10;
    const x = side < 2 ? t * W : side === 2 ? -out : W + out;
    const y = side >= 2 ? t * H : side === 0 ? -out : H + out;
    batch.addObject(P.place(P.tree(0.9 + rnd() * 0.7, i), x, y, rnd() * 6));
  }
  // The dungeon gate sits in a rocky wall section: rocks along the top rows.
  for (let tx = 0; tx < map.w; tx++) for (let ty = 0; ty < map.h; ty++) {
    if (map.get(tx, ty) === T.WALL && tx > 0 && ty > 0 && tx < map.w - 1 && ty < map.h - 1) {
      const rock = P.mesh(P.G.dodec(1.3), texMat('town-stone', THEME_TEX.town.stone, { size: 256 }), 0, 0.7, 0);
      rock.scale.set(1, 1.6, 1);
      const gq = new THREE.Group(); gq.add(rock);
      batch.addObject(P.place(gq, tx * TILE + 1, ty * TILE + 1, tx * 1.3));
    }
  }
}
