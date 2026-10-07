// Wall cutaway: anything tagged with the centre of a wall tile (aCenter) drops to knee height
// when that wall sits between the camera and the hero. Walls, their trim and everything
// mounted on them share this, so a cut wall never leaves floating torches-trim behind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const cutUniforms = { uCut: { value: new THREE.Vector4(0, 0, 0, 1) }, uCutOn: { value: 1 } };

const cutCache = new Map();
export function cutaway(mat) {
  if (cutCache.has(mat)) return cutCache.get(mat);
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
  m.customProgramCacheKey = () => 'cut'; // same patch for every material: share programs
  cutCache.set(mat, m);
  return m;
}
export function clearCutCache() { cutCache.clear(); }

// Merges static geometry per material. Pieces added with a wall centre get the cutaway;
// pieces without one are plain. `worldUV` re-maps UVs from world position (boxes, trim)
// so textures keep a constant scale however a piece is stretched.
export class CutBatcher {
  constructor() { this.groups = new Map(); }
  add(geo, mat, matrix, center = null, { worldUV = false, uvScale = 0.5, colors = null } = {}) {
    const key = `${mat.uuid}:${center ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) { g = { mat, cut: !!center, list: [] }; this.groups.set(key, g); }
    const c = geo.index ? geo.toNonIndexed() : geo.clone();
    const n = c.attributes.position.count;
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!c.attributes.normal) c.computeVertexNormals();
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k);
    if (matrix) c.applyMatrix4(matrix);
    if (worldUV) {
      const p = c.attributes.position; const nr = c.attributes.normal; const uv = c.attributes.uv;
      for (let i = 0; i < n; i++) {
        const ax = Math.abs(nr.getX(i)); const ay = Math.abs(nr.getY(i)); const az = Math.abs(nr.getZ(i));
        const x = p.getX(i) * uvScale; const y = p.getY(i) * uvScale; const z = p.getZ(i) * uvScale;
        if (ay >= ax && ay >= az) uv.setXY(i, x, z); else if (ax >= az) uv.setXY(i, z, y); else uv.setXY(i, x, y);
      }
    }
    if (mat.vertexColors && !c.attributes.color) {
      const col = new Float32Array(n * 3);
      const cc = colors || [1, 1, 1];
      for (let i = 0; i < n; i++) { col[i * 3] = cc[0]; col[i * 3 + 1] = cc[1]; col[i * 3 + 2] = cc[2]; }
      c.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    } else if (!mat.vertexColors && c.attributes.color) c.deleteAttribute('color');
    if (center) {
      const a = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { a[i * 2] = center[0]; a[i * 2 + 1] = center[1]; }
      c.setAttribute('aCenter', new THREE.Float32BufferAttribute(a, 2));
    }
    g.list.push(c);
  }
  addObject(obj, center = null, opts) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (o.isMesh && o.visible !== false) this.add(o.geometry, o.material, o.matrixWorld, center, opts); });
  }
  build(parent, { shadows = true } = {}) {
    for (const g of this.groups.values()) {
      const geo = mergeGeometries(g.list, false);
      for (const x of g.list) x.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, g.cut ? cutaway(g.mat) : g.mat);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.receiveShadow = true; mesh.castShadow = shadows && !g.mat.transparent;
      if (g.mat.transparent) mesh.renderOrder = 2;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}
