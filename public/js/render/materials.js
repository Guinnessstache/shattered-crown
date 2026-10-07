// Shared materials, built once per quality level.
import * as THREE from 'three';
import { paint, THEME_TEX } from './textures.js';

let quality = 'high';
const mats = new Map();

export function setMaterialQuality(q) { quality = q; }
export function texSize() { return quality === 'high' ? 512 : 256; }
export function useNormals() { return quality !== 'low'; }

// Textured standard material. `repeat` scales UVs (geometry UVs are in meters / tile).
// Painters that output roughness/emissive get those maps too: wet stone shines, lava seams glow.
export function texMat(key, def, { repeat = 1, rough = 0.9, metal = 0, color = 0xffffff, emissive = 0x000000, glowK = 2.2, size } = {}) {
  const id = `${key}:${quality}:${repeat}:${rough}:${metal}:${color}:${glowK}`;
  if (mats.has(id)) return mats.get(id);
  const { map, normalMap, roughnessMap, emissiveMap } = paint(key, def, size || texSize(), useNormals());
  const m = new THREE.MeshStandardMaterial({ map, normalMap: normalMap || null, roughness: rough, metalness: metal, color, emissive });
  if (roughnessMap && quality !== 'low') { m.roughnessMap = roughnessMap; m.roughness = Math.min(1, rough + 0.1); }
  if (emissiveMap) { m.emissiveMap = emissiveMap; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = glowK; }
  if (repeat !== 1) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
      if (!m[k]) continue;
      const src = m[k];
      m[k] = src.clone(); m[k].repeat.set(repeat, repeat);
      if (src.userData.clones && !src.userData.loaded) src.userData.clones.push(m[k]); else m[k].needsUpdate = true;
    }
  }
  if (m.normalMap) m.normalScale.set(1, 1);
  mats.set(id, m);
  return m;
}

export function common(name, opts = {}) {
  return texMat(`common-${name}`, THEME_TEX.common[name], { size: 256, ...opts });
}

export function flat(color, { rough = 0.8, metal = 0, emissive = 0x000000, emissiveIntensity = 1, transparent = false, opacity = 1, side } = {}) {
  const id = `flat:${color}:${rough}:${metal}:${emissive}:${emissiveIntensity}:${opacity}:${side}`;
  if (mats.has(id)) return mats.get(id);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity, transparent, opacity, side: side ?? THREE.FrontSide });
  mats.set(id, m);
  return m;
}

export function glow(color, opacity = 1) {
  const id = `glow:${color}:${opacity}`;
  if (mats.has(id)) return mats.get(id);
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
  mats.set(id, m);
  return m;
}

// Soft round sprite used for flames, sparks, glows and blob shadows.
let softTex = null;
export function softTexture() {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}

let flameTex = null;
export function flameTexture() {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 92, 2, 32, 80, 60);
  grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(0.25, 'rgba(255,190,80,.95)'); grd.addColorStop(0.55, 'rgba(255,90,20,.6)'); grd.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(60, 60, 58, 120, 32, 124); g.bezierCurveTo(6, 120, 4, 60, 32, 4); g.fill();
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

let shadowMat = null;
export function blobShadowMaterial() {
  if (shadowMat) return shadowMat;
  shadowMat = new THREE.MeshBasicMaterial({ map: softTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  return shadowMat;
}
