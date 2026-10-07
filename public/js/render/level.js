// Turns a GameMap (shared/map.js) into meshes: floors with baked corner shading, walls that
// cut away between the camera and the hero, props, and the light anchors.
import * as THREE from 'three';
import { TILE, T } from '/shared/map.js';
import { texMat } from './materials.js';
import { THEME_TEX } from './textures.js';
import * as P from './props.js';
import { cutUniforms, cutaway, CutBatcher } from './cut.js';
import { dressDungeon, dressTownGround } from './dress.js';
import { buildTownGround, buildTownBorder, dressTown, fountainStatue } from './town.js';

export const WALL_H = 3.2;
export { cutUniforms };

export function buildLevel(map, quality) {
  const root = new THREE.Group();
  const anim = []; // things that animate (flames, water, glows)
  const lights = []; // light anchors { x, y, h, color, flame }
  const batch = new P.Batcher();
  const isTown = map.kind === 'town';
  const theme = map.theme;

  const cb = new CutBatcher();
  if (isTown) buildTownGround(map, root, quality);
  else buildDungeonGeometry(map, root, theme, cb);

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
      case 'arena': {
        const g = new THREE.Group();
        const sand = new THREE.Mesh(new THREE.CircleGeometry(pr.r, 48), texMat('arena-sand', THEME_TEX.extra.sand, { rough: 0.95, repeat: 3 }));
        sand.rotation.x = -Math.PI / 2; sand.position.y = 0.025; sand.receiveShadow = true; g.add(sand);
        const lineM = new THREE.MeshBasicMaterial({ color: 0x6a4a2a });
        const line = new THREE.Mesh(new THREE.RingGeometry(pr.r - 0.18, pr.r, 64), lineM); line.rotation.x = -Math.PI / 2; line.position.y = 0.03; g.add(line);
        const mid = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.25, 40), lineM); mid.rotation.x = -Math.PI / 2; mid.position.y = 0.03; g.add(mid);
        const wood = texMat('arena-wood', THEME_TEX.common.darkwood, { rough: 0.9 });
        const rope = new THREE.MeshStandardMaterial({ color: 0xb89a6a, roughness: 0.95 });
        const n = 22;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          if (Math.abs(Math.sin(a) + 1) < 0.25) continue; // gap facing the town (north)
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 7), wood);
          post.position.set(Math.cos(a) * (pr.r + 0.25), 0.6, Math.sin(a) * (pr.r + 0.25)); post.castShadow = true; g.add(post);
          const a2 = ((i + 1) / n) * Math.PI * 2;
          if (Math.abs(Math.sin(a2) + 1) < 0.25) continue;
          const p1 = new THREE.Vector3(Math.cos(a) * (pr.r + 0.25), 1.0, Math.sin(a) * (pr.r + 0.25));
          const p2 = new THREE.Vector3(Math.cos(a2) * (pr.r + 0.25), 1.0, Math.sin(a2) * (pr.r + 0.25));
          const len = p1.distanceTo(p2);
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), rope);
          r.position.copy(p1).add(p2).multiplyScalar(0.5); r.position.y -= 0.06;
          r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
          g.add(r);
        }
        g.position.set(x, 0, y);
        root.add(g);
        break;
      }
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
        break;
      }
      case 'house': batch.addObject(P.place(P.house(rot ? pr.w : pr.w, pr.d, pr.variant), x, y, rot)); break;
      case 'fountain': {
        const f = P.place(P.fountain(pr.w, pr.d), x, y, rot); root.add(f); anim.push(f);
        const st = fountainStatue();
        if (st) { st.position.set(x, f.userData.statueY, y); st.rotation.y = rot; st.scale.setScalar(1.1); batch.addObject(st); }
        break;
      }
      case 'tree': batch.addObject(P.place(P.tree(pr.s, Math.round(pr.rot * 7)), x, y, rot)); break;
      case 'lamppost': {
        batch.addObject(P.place(P.lamppost(), x, y, 0));
        lights.push({ x, y, h: 3.3, color: 0xffc070, night: true });
        break;
      }
      case 'dungeonGate': { root.add(P.place(P.dungeonGate(), x, y, rot)); const gl = P.gateGlow(); gl.position.set(x, 1.6, y - 0.1); root.add(gl); lights.push({ x, y: y + 1.5, h: 1.5, color: 0xff6a20, night: true }); break; }
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
    buildTownBorder(map, batch, quality);
    // NPC stalls
    for (const n of map.npcs) {
      const s = n.type === 'smith' ? P.anvil() : P.stall(n.type === 'crafter' ? 0x5a2a7a : n.type === 'auctioneer' ? 0x2a6a3a : 0x2a5a8a);
      batch.addObject(P.place(s, n.x + Math.sin(n.rot) * (n.type === 'smith' ? 1.1 : -0.2), n.y + Math.cos(n.rot) * (n.type === 'smith' ? 1.1 : -0.2), n.rot + (n.type === 'smith' ? Math.PI / 2 : Math.PI)));
    }
  }
  if (isTown) { dressTown(map, { root, batch, anim, lights, quality }); dressTownGround(map, root, quality); }
  else dressDungeon(map, { root, batch, cb, anim, lights, quality, theme, wallH: WALL_H });
  batch.build(root);
  batch.extra?.build(root);
  cb.build(root);
  root.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  return { root, anim, lights };
}

// ---------------------------------------------------------------- dungeon
// Small smooth 3D value noise for rock displacement and colour variation.
function vnoise(seed) {
  const h = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.13) * 43758.5453; return v - Math.floor(v); };
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const X = Math.floor(x); const Y = Math.floor(y); const Z = Math.floor(z);
    const fx = sm(x - X); const fy = sm(y - Y); const fz = sm(z - Z);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(X, Y, Z), h(X + 1, Y, Z), fx), L(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), fx), fy),
      L(L(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), fx), L(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), fx), fy), fz) * 2 - 1;
  };
}

function geo(attrs) {
  const g = new THREE.BufferGeometry();
  for (const [k, [arr, n]] of Object.entries(attrs)) if (arr.length) g.setAttribute(k, new THREE.Float32BufferAttribute(arr, n));
  return g;
}

function buildDungeonGeometry(map, root, theme, cb) {
  const t = THEME_TEX[theme] || THEME_TEX.crypt;
  const cave = theme === 'cavern';
  const floorMat = texMat(`${theme}-floor`, t.floor, { rough: 0.92 });
  const wallMat = cutaway(texMat(`${theme}-wall`, t.wall, { rough: 0.95 }));
  const topMat = cutaway(texMat(`${theme}-top`, t.top, { rough: 1 }));
  floorMat.vertexColors = true; floorMat.needsUpdate = true;
  wallMat.vertexColors = true;
  const vn = vnoise(map.floor || 1);

  const open = (x, y) => { const v = map.get(x, y); return v === T.FLOOR || v === T.PILLAR; };
  const nearOpen = (tx, ty) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (open(tx + ox, ty + oy)) return true; return false; };

  // Floors: one quad per tile (also under walls next to rooms, so displaced rock and trim
  // never show the void), corners darkened by neighbouring walls (cheap baked AO) and a
  // broad tint so big rooms don't read as one repeated texture.
  const fp = []; const fn = []; const fu = []; const fc = [];
  const solid = (x, y) => (open(x, y) ? 0 : 1);
  const ao = (vx, vy) => [1, 0.7, 0.5, 0.42, 0.38][solid(vx - 1, vy - 1) + solid(vx, vy - 1) + solid(vx - 1, vy) + solid(vx, vy)];
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const isOpen = open(tx, ty);
      if (!isOpen && !(map.get(tx, ty) === T.WALL && nearOpen(tx, ty))) continue;
      const x0 = tx * TILE; const z0 = ty * TILE; const x1 = x0 + TILE; const z1 = z0 + TILE;
      const c = [[x0, z0, ao(tx, ty)], [x1, z0, ao(tx + 1, ty)], [x1, z1, ao(tx + 1, ty + 1)], [x0, z1, ao(tx, ty + 1)]];
      for (const i of [0, 3, 1, 1, 3, 2]) {
        const [x, z, a0] = c[i];
        const a = isOpen ? a0 : 0.3;
        const tint = 1 + vn(x * 0.11, 0, z * 0.11) * 0.16 + vn(x * 0.37, 3, z * 0.37) * 0.06;
        fp.push(x, 0, z); fn.push(0, 1, 0); fu.push(x / 4, z / 4);
        fc.push(a * tint * (cave ? 1.02 : 1), a * tint, a * tint * (cave ? 0.96 : 1));
      }
    }
  }
  const floor = new THREE.Mesh(geo({ position: [fp, 3], normal: [fn, 3], uv: [fu, 2], color: [fc, 3] }), floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // Walls: only faces that border walkable space, plus tops. aCenter drives the cutaway.
  // Caverns: faces are subdivided and pushed around by world-space noise (shared edges move
  // together, so the rock stays watertight) and the rim undulates.
  const wp = []; const wu = []; const wc = []; const wa = [];
  const tp = []; const tu = []; const ta = [];
  const H = WALL_H;
  const disp = (x, y, z) => {
    if (!cave) return [x, y, z];
    const k = y / H;
    const dx = vn(x * 0.55, y * 0.45, z * 0.55) * 0.42 + vn(x * 1.6, y * 1.4, z * 1.6) * 0.14;
    const dz = vn(x * 0.55 + 40, y * 0.45, z * 0.55) * 0.42 + vn(x * 1.6 + 40, y * 1.4, z * 1.6) * 0.14;
    const dy = y > 0.05 ? vn(x * 0.35, 9, z * 0.35) * 0.7 * k : 0;
    const bulge = 0.6 + 0.4 * Math.sin(k * Math.PI);
    return [x + dx * bulge, y + dy, z + dz * bulge];
  };
  const S = cave ? 4 : 1;
  // A face from (ax,az) to (bx,bz), 0..h, subdivided SxS.
  const face = (ax, az, bx, bz, h, center, shade, nrm) => {
    const ux = (bx - ax) / S; const uz = (bz - az) / S;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => {
        const px = ax + ux * a; const pz = az + uz * a; const py = h * b / S;
        return { p: disp(px, py, pz), uv: [(px * Math.abs(nrm[2]) + pz * Math.abs(nrm[0])) / 2, py / 2.6], y: py };
      });
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const v = q[k];
        wp.push(...v.p); wu.push(...v.uv); wa.push(...center);
        const sh = shade * (v.y < 0.01 ? 0.55 : v.y < 0.6 ? 0.8 : 1);
        wc.push(sh, sh, sh);
      }
    }
  };
  const top = (x0, z0, x1, z1, h, center) => {
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const q = [[i, j + 1], [i + 1, j + 1], [i + 1, j], [i, j]].map(([a, b]) => {
        const px = x0 + (x1 - x0) * a / S; const pz = z0 + (z1 - z0) * b / S;
        return { p: disp(px, h, pz), uv: [px / 4, pz / 4] };
      });
      for (const k of [0, 1, 2, 0, 2, 3]) { tp.push(...q[k].p); tu.push(...q[k].uv); ta.push(...center); }
    }
  };
  const trim = cave ? null : texMat(`${theme}-trim`, t.trim || t.pillar, { rough: 0.9, size: 256 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mtx = new THREE.Matrix4();
  const addBox = (cx, cy, cz, sx, sy, sz, rotY, center) => {
    mtx.compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
    cb.add(box, trim, mtx, center, { worldUV: true, uvScale: 0.5 });
  };
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (map.get(tx, ty) !== T.WALL) continue;
      const x0 = tx * TILE; const z0 = ty * TILE; const x1 = x0 + TILE; const z1 = z0 + TILE;
      const cen = [x0 + 1, z0 + 1];
      const h = cave ? H : H + (((tx * 73856093) ^ (ty * 19349663)) % 7) * 0.03;
      const faces = [];
      if (open(tx, ty + 1)) { face(x0, z1, x1, z1, h, cen, 1, [0, 0, 1]); faces.push([0, 1]); }
      if (open(tx, ty - 1)) { face(x1, z0, x0, z0, h, cen, 0.85, [0, 0, -1]); faces.push([0, -1]); }
      if (open(tx + 1, ty)) { face(x1, z1, x1, z0, h, cen, 0.92, [1, 0, 0]); faces.push([1, 0]); }
      if (open(tx - 1, ty)) { face(x0, z0, x0, z1, h, cen, 0.92, [-1, 0, 0]); faces.push([-1, 0]); }
      if (nearOpen(tx, ty)) top(x0, z0, x1, z1, h, cen);
      if (!trim) continue;
      // Architecture: a plinth along the foot, a cornice under the rim, and pilasters
      // on straight runs so long corridors get rhythm.
      for (const [nx, nz] of faces) {
        const fx = x0 + 1 + nx; const fz = z0 + 1 + nz; // face centre
        const rot = Math.atan2(nx, nz);
        const along = nx === 0; // face runs along x
        const L = TILE + 0.02;
        addBox(fx + nx * 0.07, 0.16, fz + nz * 0.07, along ? L : 0.14, 0.32, along ? 0.14 : L, 0, cen);
        addBox(fx + nx * 0.08, h - 0.12, fz + nz * 0.08, along ? L : 0.16, 0.24, along ? 0.16 : L, 0, cen);
        addBox(fx + nx * 0.04, h - 0.34, fz + nz * 0.04, along ? L : 0.08, 0.1, along ? 0.08 : L, 0, cen);
        const sideA = along ? map.get(tx - 1, ty) === T.WALL && open(tx - 1, ty + nz) : map.get(tx, ty - 1) === T.WALL && open(tx + nx, ty - 1);
        const sideB = along ? map.get(tx + 1, ty) === T.WALL && open(tx + 1, ty + nz) : map.get(tx, ty + 1) === T.WALL && open(tx + nx, ty + 1);
        if (sideA && sideB && (tx * 3 + ty * 5) % 3 === 0) {
          addBox(fx + nx * 0.12, h / 2, fz + nz * 0.12, 0.56, h, 0.24, rot, cen);
          addBox(fx + nx * 0.18, 0.25, fz + nz * 0.18, 0.76, 0.5, 0.36, rot, cen);
          addBox(fx + nx * 0.2, h - 0.5, fz + nz * 0.2, 0.74, 0.26, 0.4, rot, cen);
        }
      }
    }
  }
  const wg = geo({ position: [wp, 3], uv: [wu, 2], color: [wc, 3], aCenter: [wa, 2] });
  wg.computeVertexNormals();
  root.add(new THREE.Mesh(wg, wallMat));
  const tg = geo({ position: [tp, 3], uv: [tu, 2], aCenter: [ta, 2] });
  tg.computeVertexNormals();
  root.add(new THREE.Mesh(tg, topMat));

  // A black void plane under everything so gaps never show the clear color oddly.
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(map.w * TILE + 80, map.h * TILE + 80), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  voidPlane.rotation.x = -Math.PI / 2; voidPlane.position.set(map.w, -0.05, map.h);
  root.add(voidPlane);
}
